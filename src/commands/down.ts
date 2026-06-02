import { createAwsAdapter, secretName } from "../aws";
import {
  resolveEnvironment,
  upsertEnvironmentInContent,
} from "../environment";
import { writeFilesFromPayload } from "../file-sync";
import {
  generateLocalEnvContent,
  parseEnvFile,
  parseEnvValues,
} from "../parser";
import { normalizeProjectSecret } from "../project-secret";
import type { CommandContext } from "../types";
import { EnvManagerError } from "../types";
import { assertValid, validateEnv } from "../validator";

export async function downCommand(ctx: CommandContext): Promise<void> {
  const envPath = `${ctx.cwd}/.env`;
  const localPath = `${ctx.cwd}/.env.local`;

  const aws = createAwsAdapter();
  const environment = await resolveEnvironment(ctx.cwd);
  const secret = await aws.getSecret(secretName(ctx.project));

  if (!secret) {
    throw new EnvManagerError(
      `Project "${ctx.project}" not found in AWS Secrets Manager`
    );
  }

  const projectSecret = normalizeProjectSecret(secret);
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

  await Bun.write(
    envPath,
    upsertEnvironmentInContent(projectSecret.schema, environment)
  );

  await Bun.write(
    localPath,
    generateLocalEnvContent(parsed.schema, values, {
      project: parsed.header?.project ?? ctx.project,
      syncDate: envPayload.syncDate,
    })
  );

  console.log(
    `Downloaded ${ctx.project}/${environment} from AWS Secrets Manager`
  );
}
