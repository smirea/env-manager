import { createAwsAdapter, secretName } from "../aws";
import {
  appendSchemaEntry,
  parseEnvFile,
  parseEnvValues,
  setEnvValue,
  updateHeaderSyncDate,
} from "../parser";
import { getProvider, listProviders } from "../providers";
import type { CommandContext, SecretPayload } from "../types";
import { EnvManagerError } from "../types";
import { assertValid, validateEnv } from "../validator";

export async function newKeyCommand(
  ctx: CommandContext,
  provider: string,
  envName?: string
): Promise<void> {
  const prov = getProvider(provider);
  if (!prov) {
    const available = listProviders().join(", ");
    throw new EnvManagerError(
      `Unknown provider: ${provider}. Available: ${available}`
    );
  }

  const varName = envName ?? prov.defaultEnvName;

  const envPath = `${ctx.cwd}/.env`;
  const localPath = `${ctx.cwd}/.env.local`;

  const envFile = Bun.file(envPath);
  if (!(await envFile.exists())) {
    throw new EnvManagerError(
      "Project not initialized. Run 'env-manager init' first."
    );
  }

  let envContent = await envFile.text();
  const parsed = parseEnvFile(envContent);

  if (!parsed.header) {
    throw new EnvManagerError(
      ".env is missing env-manager header. Run: env-manager init"
    );
  }

  const existsInSchema = parsed.schema.some((s) => s.name === varName);
  if (!existsInSchema) {
    console.log(`Adding ${varName} to .env schema...`);
    envContent = appendSchemaEntry(envContent, varName, prov.schemaType);
  }

  console.log(`Creating ${varName} via ${provider}...`);
  const key = await prov.resolveKey(ctx.project);

  if (!prov.validateKey(key)) {
    throw new EnvManagerError(
      `Provider returned invalid key format. Got: ${key.slice(0, 20)}...`
    );
  }

  let localContent = "";
  const localFile = Bun.file(localPath);
  if (await localFile.exists()) {
    localContent = await localFile.text();
  }
  localContent = setEnvValue(localContent, varName, key);

  await Bun.write(envPath, envContent);
  await Bun.write(localPath, localContent);

  const updatedParsed = parseEnvFile(envContent);
  const values = parseEnvValues(localContent);
  const result = validateEnv(updatedParsed.schema, values);
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

  console.log(`Added ${varName} and synced to AWS`);
}
