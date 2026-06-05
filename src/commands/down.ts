import { createAwsAdapter, secretName } from "../aws";
import { resolveEnvironment } from "../environment";
import { writeFilesFromPayload } from "../file-sync";
import { parseEnvFile, parseEnvValues } from "../parser";
import { normalizeProjectSecret } from "../project-secret";
import type { CommandContext } from "../types";
import { EnvManagerError } from "../types";
import { assertValid, validateEnv } from "../validator";
import {
  resolveValuesConfig,
  writeValuesForConfig,
} from "../values-config";
import { updateConfiguredTsOutput } from "./ts";

export async function downCommand(ctx: CommandContext): Promise<void> {
  const envPath = `${ctx.cwd}/.env`;

  const aws = createAwsAdapter();
  const secret = await aws.getSecret(secretName(ctx.project));

  if (!secret) {
    throw new EnvManagerError(
      `Project "${ctx.project}" not found in AWS Secrets Manager`
    );
  }

  const projectSecret = normalizeProjectSecret(secret);
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

  const parsed = parseEnvFile(projectSecret.schema);
  const values = parseEnvValues(envPayload.values);

  const result = validateEnv(parsed.schema, values);
  assertValid(result);

  await writeFilesFromPayload(parsed.schema, values, envPayload.files, ctx.cwd);

  await Bun.write(envPath, projectSecret.schema);

  await writeValuesForConfig(
    ctx,
    valuesConfig,
    parsed.schema,
    values,
    environment,
    {
      project: parsed.header?.project ?? ctx.project,
      syncDate: envPayload.syncDate,
    }
  );
  await updateConfiguredTsOutput(ctx, projectSecret.schema);

  console.log(
    `Downloaded ${ctx.project}/${environment} from AWS Secrets Manager`
  );
}
