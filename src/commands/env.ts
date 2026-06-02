import { createAwsAdapter, secretName } from '../aws';
import {
  resolveEnvironment,
  upsertEnvironmentInContent,
  validateEnvironmentName,
} from '../environment';
import { parseEnvFile } from '../parser';
import {
  createProjectSecretPayload,
  listProjectEnvironments,
  normalizeProjectSecret,
} from '../project-secret';
import type { CommandContext } from '../types';
import { EnvManagerError } from '../types';

export async function envSetCommand(
  ctx: CommandContext,
  environment: string
): Promise<void> {
  validateEnvironmentName(environment);

  const envPath = `${ctx.cwd}/.env`;
  const envFile = Bun.file(envPath);
  if (await envFile.exists()) {
    const parsed = parseEnvFile(await envFile.text());
    if (parsed.header && parsed.header.project !== ctx.project) {
      throw new EnvManagerError(
        `.env project "${parsed.header.project}" does not match --project "${ctx.project}"`
      );
    }
  }

  const localPath = `${ctx.cwd}/.env.local`;
  const localFile = Bun.file(localPath);
  const localContent = (await localFile.exists()) ? await localFile.text() : '';
  await Bun.write(
    localPath,
    upsertEnvironmentInContent(localContent, environment)
  );
  console.log(`Set default environment to ${environment}`);
}

export async function envListCommand(ctx: CommandContext): Promise<void> {
  const aws = createAwsAdapter();
  const secret = await aws.getSecret(secretName(ctx.project));
  if (!secret) {
    throw new EnvManagerError(
      `Project "${ctx.project}" not found in AWS Secrets Manager`
    );
  }

  const current = await resolveEnvironment(ctx.cwd);
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
