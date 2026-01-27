import { createAwsAdapter, secretName } from "../aws";
import { parseEnvFile, parseEnvValues, updateHeaderSyncDate } from "../parser";
import type { CommandContext, SecretPayload } from "../types";
import { EnvManagerError } from "../types";
import { assertValid, validateEnv } from "../validator";

export async function upCommand(ctx: CommandContext): Promise<void> {
  const envPath = `${ctx.cwd}/.env`;
  const localPath = `${ctx.cwd}/.env.local`;

  const envFile = Bun.file(envPath);
  if (!(await envFile.exists())) {
    throw new EnvManagerError(`.env not found at ${envPath}`);
  }

  let envContent = await envFile.text();
  const parsed = parseEnvFile(envContent);

  if (!parsed.header) {
    throw new EnvManagerError(
      ".env is missing env-manager header. Run: env-manager init"
    );
  }

  let values: Record<string, string> = {};
  const localFile = Bun.file(localPath);
  if (await localFile.exists()) {
    const localContent = await localFile.text();
    values = parseEnvValues(localContent);
  }

  const result = validateEnv(parsed.schema, values);
  assertValid(result);

  const now = new Date().toISOString();
  envContent = updateHeaderSyncDate(envContent, now);

  const aws = createAwsAdapter(ctx.useSdk);
  const payload: SecretPayload = {
    schema: envContent,
    values: Object.entries(values)
      .map(([k, v]) => `${k}=${v}`)
      .join("\n"),
    syncDate: now,
  };

  await aws.putSecret(secretName(ctx.project), payload);
  await Bun.write(envPath, envContent);

  console.log(`Uploaded ${ctx.project} to AWS Secrets Manager`);
}
