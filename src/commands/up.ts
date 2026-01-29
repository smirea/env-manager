import { createAwsAdapter, secretName } from "../aws";
import { collectFilePayload } from "../file-sync";
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
  let parsed = parseEnvFile(envContent);

  if (parsed.header && parsed.header.project !== ctx.project) {
    throw new EnvManagerError(
      `.env project "${parsed.header.project}" does not match --project "${ctx.project}"`
    );
  }

  const aws = createAwsAdapter();
  const now = new Date().toISOString();

  if (!parsed.header) {
    const secret = await aws.getSecret(secretName(ctx.project));
    if (secret) {
      throw new EnvManagerError(
        ".env is missing env-manager header. Run: env-manager init"
      );
    }

    const header = `#env-manager: ${ctx.project} | ${now}`;
    envContent = `${header}\n\n${envContent}`;
    await Bun.write(envPath, envContent);
    console.log(`Added env-manager header to ${envPath}`);
    parsed = parseEnvFile(envContent);
  }

  let values: Record<string, string> = {};
  const localFile = Bun.file(localPath);
  if (await localFile.exists()) {
    const localContent = await localFile.text();
    values = parseEnvValues(localContent);
  }

  const result = validateEnv(parsed.schema, values);
  assertValid(result);

  const files = await collectFilePayload(parsed.schema, values, ctx.cwd);

  envContent = updateHeaderSyncDate(envContent, now);

  const payload: SecretPayload = {
    schema: envContent,
    values: Object.entries(values)
      .map(([k, v]) => `${k}=${v}`)
      .join("\n"),
    syncDate: now,
    files: Object.keys(files).length > 0 ? files : undefined,
  };

  await aws.putSecret(secretName(ctx.project), payload);
  await Bun.write(envPath, envContent);

  console.log(`Uploaded ${ctx.project} to AWS Secrets Manager`);
}
