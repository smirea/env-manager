import { createAwsAdapter, secretName } from "../aws";
import { parseEnvFile, parseEnvValues, updateHeaderSyncDate } from "../parser";
import type { CommandContext } from "../types";
import { EnvManagerError } from "../types";
import { assertValid, validateEnv } from "../validator";

export async function downCommand(ctx: CommandContext): Promise<void> {
  const envPath = `${ctx.cwd}/.env`;
  const localPath = `${ctx.cwd}/.env.local`;

  const aws = createAwsAdapter(ctx.useSdk);
  const secret = await aws.getSecret(secretName(ctx.project));

  if (!secret) {
    throw new EnvManagerError(
      `Project "${ctx.project}" not found in AWS Secrets Manager`
    );
  }

  const parsed = parseEnvFile(secret.schema);
  const values = parseEnvValues(secret.values);

  const result = validateEnv(parsed.schema, values);
  assertValid(result);

  const now = new Date().toISOString();
  const updatedSchema = updateHeaderSyncDate(secret.schema, now);

  await Bun.write(envPath, updatedSchema);

  if (secret.values) {
    await Bun.write(localPath, secret.values + "\n");
  }

  console.log(`Downloaded ${ctx.project} from AWS Secrets Manager`);
}
