import { planGeneration, syncOutputs } from './generate';
import { writeManagedFile } from '../git-updates';
import { createAwsAdapter, secretName } from "../aws";
import { findEnvironment, upsertEnvironmentInContent, validateEnvironmentName } from "../environment";
import { writeFilesFromPayload } from "../file-sync";
import { envValuesEqual, parseEnvFile, parseEnvValues } from "../parser";
import { normalizeProjectSecret } from "../project-secret";
import type { CommandContext, EnvironmentPayload } from "../types";
import { EnvManagerError } from "../types";
import { assertValid, validateEnv } from "../validator";
import {
  readValuesForConfig,
  resolveValuesConfig,
  resolveValuesOutputPath,
  writeValuesForConfig,
} from "../values-config";
import { readFileVersion } from '../versions';
import { join, relative } from 'node:path';

export async function pullEnvironment(
  ctx: CommandContext,
  schema: string,
  environment: string,
  envPayload: EnvironmentPayload
): Promise<void> {
  const valuesConfig = await resolveValuesConfig(ctx, schema);
  const parsed = parseEnvFile(schema);
  const values = parseEnvValues(envPayload.values);
  assertValid(validateEnv(parsed.schema, values));

  await writeFilesFromPayload(parsed.schema, values, envPayload.files, ctx.cwd);
  await writeManagedFile(`${ctx.cwd}/.env`, schema);

  const valuesPath = resolveValuesOutputPath(ctx, valuesConfig);
  const valuesFile = Bun.file(valuesPath);
  const localVersion = await valuesFile.exists() ? readFileVersion(await valuesFile.text()) : null;
  const remoteVersion = envPayload.outputs?.[relative(ctx.cwd, valuesPath)]?.version ?? 0;
  const recorded = await findEnvironment(ctx.cwd, {
    valuesPath: valuesConfig.format === 'ts' ? valuesConfig.path : undefined,
  });
  const stale = localVersion === null
    || localVersion < remoteVersion
    || (valuesConfig.format === 'ts' && recorded !== environment)
    || !envValuesEqual(await readValuesForConfig(ctx, valuesConfig), values);
  if (stale) {
    await writeValuesForConfig(ctx, valuesConfig, parsed.schema, values, environment, {
      project: parsed.header?.project ?? ctx.project,
      version: null,
    });
  }
  if (valuesConfig.format === 'swift' && recorded !== environment) {
    const selectorPath = join(ctx.cwd, '.env.local');
    const selector = Bun.file(selectorPath);
    await writeManagedFile(selectorPath, upsertEnvironmentInContent(await selector.exists() ? await selector.text() : '', environment));
  }
  await syncOutputs(ctx, schema, envPayload.outputs);
}

export async function downCommand(ctx: CommandContext, options: { environment?: string } = {}): Promise<void> {
  if (options.environment) validateEnvironmentName(options.environment);
  const aws = createAwsAdapter();
  const secret = await aws.getSecret(secretName(ctx.project));

  if (!secret) {
    throw new EnvManagerError(
      `Project "${ctx.project}" not found in AWS Secrets Manager`
    );
  }

  const projectSecret = normalizeProjectSecret(secret);
  await planGeneration(ctx, projectSecret.schema);
  const valuesConfig = await resolveValuesConfig(ctx, projectSecret.schema);
  const available = Object.keys(projectSecret.environments);
  const environment = options.environment
    ?? await findEnvironment(ctx.cwd, {
      valuesPath: valuesConfig.format === 'ts' ? valuesConfig.path : undefined,
    })
    ?? (available.length === 1 ? available[0] : null);
  if (!environment) {
    throw new EnvManagerError(
      `No environment selected for "${ctx.project}". Pass --env <name> or run "env-manager env set <name>". Available: ${available.join(', ')}`
    );
  }
  const envPayload = projectSecret.environments[environment];
  if (!envPayload) {
    throw new EnvManagerError(
      `Environment "${environment}" not found for project "${ctx.project}". Available: ${available.join(', ')}`
    );
  }

  await pullEnvironment(ctx, projectSecret.schema, environment, envPayload);

  console.log(
    `Downloaded ${ctx.project}/${environment} from AWS Secrets Manager`
  );
}
