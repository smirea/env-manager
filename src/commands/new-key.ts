import { createAwsAdapter, secretName } from "../aws";
import { collectFilePayload } from "../file-sync";
import { GLOBAL_LABEL, GLOBAL_PROJECT } from "../global";
import { getKey, listKeys, listKeyNames } from "../keys";
import type { KeyResolveOptions } from "../keys";
import { promptLine } from "../prompt";
import {
  appendSchemaEntry,
  generateLocalEnvContent,
  parseEnvFile,
  parseEnvValues,
  updateHeaderSyncDate,
} from "../parser";
import type { CommandContext, SecretPayload } from "../types";
import { EnvManagerError } from "../types";
import { assertValid, validateEnv } from "../validator";

type NewKeyOptions = {
  assumeYes?: boolean;
  name?: string;
  credit?: number;
  expiration?: string;
};

async function promptChoice(
  question: string,
  options: string[],
  defaultChoice: number,
  assumeYes: boolean
): Promise<number> {
  if (assumeYes) {
    return defaultChoice;
  }
  if (!process.stdin.isTTY) {
    throw new EnvManagerError(
      "Non-interactive shell detected. Re-run with --yes to accept defaults."
    );
  }
  console.log(question);
  options.forEach((opt, i) => console.log(`  [${i + 1}] ${opt}`));

  let prompt = "Choice: ";
  while (true) {
    const input = await promptLine(prompt);
    const choice = parseInt(input.trim(), 10);
    if (choice >= 1 && choice <= options.length) {
      return choice;
    }
    prompt = "Invalid choice. Try again: ";
  }
}

export function listKeysCommand(): void {
  const keys = listKeys();
  console.log("Available keys:");
  const maxLen = Math.max(...keys.map((k) => k.envName.length));
  for (const key of keys) {
    console.log(`  ${key.envName.padEnd(maxLen + 2)}${key.description}`);
  }
}

async function getGlobalValue(
  aws: ReturnType<typeof createAwsAdapter>,
  keyName: string
): Promise<string | null> {
  const secret = await aws.getSecret(secretName(GLOBAL_PROJECT));
  if (!secret?.values) return null;

  const values = parseEnvValues(secret.values);
  return values[keyName] ?? null;
}

async function saveToGlobal(
  aws: ReturnType<typeof createAwsAdapter>,
  keyName: string,
  keyValue: string,
  schemaType: string,
  location?: string
): Promise<void> {
  let secret = await aws.getSecret(secretName(GLOBAL_PROJECT));

  const now = new Date().toISOString();

  if (!secret) {
    const header = `#env-manager: ${GLOBAL_PROJECT} | ${now}\n\n`;
    const locations = location ? { [keyName]: location } : undefined;
    secret = {
      schema: header + `${keyName}= # {${schemaType}}\n`,
      values: `${keyName}=${keyValue}`,
      syncDate: now,
      locations,
    };
  } else {
    let schema = secret.schema;
    const parsed = parseEnvFile(schema);
    const existsInSchema = parsed.schema.some((s) => s.name === keyName);
    if (!existsInSchema) {
      schema = appendSchemaEntry(schema, keyName, schemaType);
    }
    schema = updateHeaderSyncDate(schema, now);

    const values = parseEnvValues(secret.values);
    values[keyName] = keyValue;

    const locations = { ...secret.locations };
    if (location) {
      locations[keyName] = location;
    }

    secret = {
      schema,
      values: Object.entries(values)
        .map(([k, v]) => `${k}=${v}`)
        .join("\n"),
      syncDate: now,
      files: secret.files,
      locations: Object.keys(locations).length > 0 ? locations : undefined,
    };
  }

  await aws.putSecret(secretName(GLOBAL_PROJECT), secret);
}

export async function newKeyCommand(
  ctx: CommandContext,
  keyName: string,
  options: NewKeyOptions = {}
): Promise<void> {
  const assumeYes = options.assumeYes === true;
  const usingOpenRouterOptions =
    options.name !== undefined ||
    options.credit !== undefined ||
    options.expiration !== undefined;

  if (keyName !== "OPENROUTER_API_KEY" && usingOpenRouterOptions) {
    throw new EnvManagerError(
      "--name, --credit, and --expiration are only supported for OPENROUTER_API_KEY."
    );
  }

  const resolveOptions: KeyResolveOptions | undefined =
    keyName === "OPENROUTER_API_KEY"
      ? {
          name: options.name,
          credit: options.credit,
          expiration: options.expiration,
        }
      : undefined;

  const keyDef = getKey(keyName);
  if (!keyDef) {
    const available = listKeyNames().join(", ");
    throw new EnvManagerError(
      `Unknown key: ${keyName}. Available: ${available}`
    );
  }

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
  if (parsed.header.project !== ctx.project) {
    throw new EnvManagerError(
      `.env project "${parsed.header.project}" does not match --project "${ctx.project}"`
    );
  }

  const existsInSchema = parsed.schema.some((s) => s.name === keyName);
  if (!existsInSchema) {
    console.log(`Adding ${keyName} to .env schema...`);
    envContent = appendSchemaEntry(envContent, keyName, keyDef.schemaType);
  }

  const aws = createAwsAdapter();
  const globalValue = await getGlobalValue(aws, keyName);

  let key: string;

  if (globalValue) {
    const choice = await promptChoice(
      `${keyName} found in ${GLOBAL_LABEL}`,
      [`Use existing from ${GLOBAL_LABEL}`, "Create new key"],
      1,
      assumeYes
    );

    if (choice === 1) {
      key = globalValue;
      console.log(`Using ${keyName} from ${GLOBAL_LABEL}`);
    } else {
      console.log(`Creating new ${keyName}...`);
      key = await keyDef.resolve(ctx.project, resolveOptions);
    }
  } else {
    console.log(`Creating ${keyName}...`);
    key = await keyDef.resolve(ctx.project, resolveOptions);
  }

  if (!keyDef.validate(key)) {
    throw new EnvManagerError(
      `Invalid key format. Got: ${key.slice(0, 20)}...`
    );
  }

  let localValues: Record<string, string> = {};
  const localFile = Bun.file(localPath);
  if (await localFile.exists()) {
    localValues = parseEnvValues(await localFile.text());
  }
  localValues[keyName] = key;
  const updatedParsed = parseEnvFile(envContent);
  const localContent = generateLocalEnvContent(
    updatedParsed.schema,
    localValues
  );

  await Bun.write(envPath, envContent);
  await Bun.write(localPath, localContent);

  const values = parseEnvValues(localContent);
  const result = validateEnv(updatedParsed.schema, values);
  assertValid(result);

  const files = await collectFilePayload(updatedParsed.schema, values, ctx.cwd);

  const now = new Date().toISOString();
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

  if (!globalValue || key !== globalValue) {
    await saveToGlobal(aws, keyName, key, keyDef.schemaType, ctx.project);
    console.log(`Saved ${keyName} to ${GLOBAL_LABEL}`);
  }

  console.log(`Added ${keyName} and synced to AWS`);
}
