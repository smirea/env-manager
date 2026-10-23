import { writeManagedFile } from '../git-updates';
import { createAwsAdapter, secretName } from '../aws';
import {
  DEFAULT_ENVIRONMENT,
  findEnvironmentInContent,
  findValuesEnvironmentInContent,
  resolveEnvironment,
  upsertSelectionInContent,
  validateEnvironmentName,
} from '../environment';
import { pullEnvironment } from './down';
import { parseEnvFile } from '../parser';
import {
  createProjectSecretPayload,
  listProjectEnvironments,
  normalizeProjectSecret,
} from '../project-secret';
import type { CommandContext } from '../types';
import { EnvManagerError } from '../types';
import {
  resolveValuesConfig,
  resolveValuesOutputPath,
} from '../values-config';

async function resolveEnvironmentValuesPath(
  ctx: CommandContext
): Promise<string | undefined> {
  const envPath = `${ctx.cwd}/.env`;
  const envFile = Bun.file(envPath);
  if (!(await envFile.exists())) {
    return undefined;
  }

  const envContent = await envFile.text();
  const parsed = parseEnvFile(envContent);
  if (parsed.header && parsed.header.project !== ctx.project) {
    throw new EnvManagerError(
      `.env project "${parsed.header.project}" does not match --project "${ctx.project}"`
    );
  }

  const valuesConfig = await resolveValuesConfig(ctx, envContent);
  return valuesConfig.format === 'ts'
    ? resolveValuesOutputPath(ctx, valuesConfig)
    : undefined;
}

// Outside local mode the switch pulls the environment like `down`, so the values file
// never holds one environment's values under another's label. A missing environment is
// seeded from the current values on the next `up`; the marker records that choice.
export async function envSetCommand(
  ctx: CommandContext,
  environment: string,
  options: { local?: boolean } = {}
): Promise<void> {
  validateEnvironmentName(environment);

  const environmentPath =
    (await resolveEnvironmentValuesPath(ctx)) ?? `${ctx.cwd}/.env.local`;
  const localFile = Bun.file(environmentPath);
  const localContent = (await localFile.exists()) ? await localFile.text() : '';
  const previous = findEnvironmentInContent(localContent) ?? DEFAULT_ENVIRONMENT;
  const loadedFrom = findValuesEnvironmentInContent(localContent) ?? previous;

  if (options.local) {
    await writeManagedFile(environmentPath, upsertSelectionInContent(localContent, environment, loadedFrom));
    console.log(`Set default environment to ${environment}`);
    if (loadedFrom !== environment) {
      console.warn(`Warning: local mode cannot load "${environment}"; the values file still holds "${loadedFrom}" values. Run "env-manager down --no-local" to load them.`);
    }
    return;
  }

  const secret = await createAwsAdapter().getSecret(secretName(ctx.project));
  const projectSecret = secret ? normalizeProjectSecret(secret) : null;
  const payload = projectSecret?.environments[environment];
  if (projectSecret && payload) {
    await pullEnvironment(ctx, projectSecret.schema, environment, payload);
    console.log(`Set default environment to ${environment} and downloaded ${ctx.project}/${environment}`);
    return;
  }

  await writeManagedFile(environmentPath, upsertSelectionInContent(localContent, environment, environment));
  console.log(`Set default environment to ${environment}`);
  console.warn(`Environment "${environment}" does not exist in AWS yet. The current values (from "${loadedFrom}") will seed it on the next "env-manager up".`);
}

export async function envListCommand(ctx: CommandContext): Promise<void> {
  const aws = createAwsAdapter();
  const secret = await aws.getSecret(secretName(ctx.project));
  if (!secret) {
    throw new EnvManagerError(
      `Project "${ctx.project}" not found in AWS Secrets Manager`
    );
  }

  const current = await resolveEnvironment(ctx.cwd, {
    valuesPath: await resolveEnvironmentValuesPath(ctx),
  });
  const environments = listProjectEnvironments(secret);
  if (environments.length === 0) {
    console.log(`No environments found for project "${ctx.project}".`);
    return;
  }

  console.log('Environments:');
  for (const environment of environments) {
    const suffix = environment === current ? ' (default)' : '';
    console.log(`  ${environment}${suffix}`);
  }
}

export async function envRmCommand(
  ctx: CommandContext,
  environment: string
): Promise<void> {
  validateEnvironmentName(environment);

  const aws = createAwsAdapter();
  const secret = await aws.getSecret(secretName(ctx.project));
  if (!secret) {
    throw new EnvManagerError(
      `Project "${ctx.project}" not found in AWS Secrets Manager`
    );
  }

  const projectSecret = normalizeProjectSecret(secret);
  if (!Object.prototype.hasOwnProperty.call(projectSecret.environments, environment)) {
    throw new EnvManagerError(
      `Environment "${environment}" not found for project "${ctx.project}"`
    );
  }

  const environments = { ...projectSecret.environments };
  delete environments[environment];

  await aws.putSecret(
    secretName(ctx.project),
    createProjectSecretPayload(projectSecret.schema, environments)
  );
  console.log(`Removed environment ${environment} from project "${ctx.project}"`);
}
