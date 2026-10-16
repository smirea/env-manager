import { planGeneration, syncOutputs } from './generate';
import { writeManagedFile } from '../git-updates';
import { createAwsAdapter, secretName } from "../aws";
import { resolveEnvironment } from "../environment";
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
import { relative } from 'node:path';

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
  const stale = localVersion === null
    || localVersion < remoteVersion
    || !envValuesEqual(await readValuesForConfig(ctx, valuesConfig), values);
  if (stale) {
    await writeValuesForConfig(ctx, valuesConfig, parsed.schema, values, environment, {
      project: parsed.header?.project ?? ctx.project,
      version: null,
    });
  }
  await syncOutputs(ctx, schema, envPayload.outputs);
}

export async function downCommand(ctx: CommandContext): Promise<void> {
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
  const environment = await resolveEnvironment(ctx.cwd, {
    valuesPath: valuesConfig.format === 'ts' ? valuesConfig.path : undefined,
  });
  const envPayload = projectSecret.environments[environment];
  if (!envPayload) {
    throw new EnvManagerError(
      `Environment "${environment}" not found for project "${ctx.project}"`
    );
  }

  await pullEnvironment(ctx, projectSecret.schema, environment, envPayload);

  console.log(
    `Downloaded ${ctx.project}/${environment} from AWS Secrets Manager`
  );
}
