import { parseRootConfig, configError } from '../config';
import { planGeneration } from './generate';
import { upCommand } from './up';
import { writeManagedFile } from '../git-updates';
import { createAwsAdapter } from "../aws";
import {
  resolveEnvironment,
} from "../environment";
import { collectFilePayload } from "../file-sync";
import { GLOBAL_LABEL } from "../global";
import { readGlobalValues, saveGlobalValue } from "./global";
import { getKey, listKeys, listKeyNames } from "../keys";
import type { KeyResolveOptions } from "../keys";
import { OPENROUTER_DEFAULT_MONTHLY_LIMIT_USD } from "../keys/openrouter";
import { promptLine } from "../prompt";
import { appendSchemaEntry, parseEnvFile } from "../parser";
import type { CommandContext } from "../types";
import { EnvManagerError } from "../types";
import { assertValid, validateEnv } from "../validator";
import {
  readValuesForConfig,
  resolveValuesConfig,
  writeValuesForConfig,
} from "../values-config";

type NewKeyOptions = {
  assumeYes?: boolean;
  name?: string;
  credit?: number;
  unlimited?: boolean;
  expiration?: string;
};

type OpenRouterLimitChoice = Pick<KeyResolveOptions, "credit" | "unlimited">;

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

async function promptOpenRouterCreditLimit(
  assumeYes: boolean
): Promise<OpenRouterLimitChoice> {
  if (assumeYes) {
    return { credit: OPENROUTER_DEFAULT_MONTHLY_LIMIT_USD };
  }
  if (!process.stdin.isTTY) {
    throw new EnvManagerError(
      `Non-interactive shell detected. Re-run with --yes to use the default OpenRouter limit (${OPENROUTER_DEFAULT_MONTHLY_LIMIT_USD} USD/month), or pass --credit/--unlimited.`
    );
  }

  let prompt = `OpenRouter monthly credit limit in USD (default ${OPENROUTER_DEFAULT_MONTHLY_LIMIT_USD}; type "unlimited" for no limit): `;
  while (true) {
    const input = (await promptLine(prompt)).trim().toLowerCase();
    if (input === "") {
      return { credit: OPENROUTER_DEFAULT_MONTHLY_LIMIT_USD };
    }
    if (input === "unlimited") {
      return { unlimited: true };
    }
    const limit = Number(input);
    if (Number.isFinite(limit) && limit >= 0) {
      return { credit: limit };
    }
    prompt = 'Invalid value. Enter a non-negative number or "unlimited": ';
  }
}

async function resolveNewKeyOptions(
  keyName: string,
  options: NewKeyOptions,
  assumeYes: boolean
): Promise<KeyResolveOptions | undefined> {
  if (keyName !== "OPENROUTER_API_KEY") {
    return undefined;
  }

  let credit = options.credit;
  let unlimited = options.unlimited;

  if (credit === undefined && unlimited !== true) {
    const limitChoice = await promptOpenRouterCreditLimit(assumeYes);
    credit = limitChoice.credit;
    unlimited = limitChoice.unlimited;
  }

  return {
    name: options.name,
    credit,
    unlimited,
    expiration: options.expiration,
  };
}

export function listKeysCommand(): void {
  const keys = listKeys();
  console.log("Available keys:");
  const maxLen = Math.max(...keys.map((k) => k.envName.length));
  for (const key of keys) {
    console.log(`  ${key.envName.padEnd(maxLen + 2)}${key.description}`);
  }
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
    options.unlimited === true ||
    options.expiration !== undefined;

  if (keyName !== "OPENROUTER_API_KEY" && usingOpenRouterOptions) {
    throw new EnvManagerError(
      "--name, --credit, --unlimited, and --expiration are only supported for OPENROUTER_API_KEY."
    );
  }
  if (
    keyName === "OPENROUTER_API_KEY" &&
    options.credit !== undefined &&
    options.unlimited === true
  ) {
    throw new EnvManagerError(
      "--credit and --unlimited cannot be used together."
    );
  }

  const keyDef = getKey(keyName);
  if (!keyDef) {
    const available = listKeyNames().join(", ");
    throw new EnvManagerError(
      `Unknown key: ${keyName}. Available: ${available}`
    );
  }

  const envPath = `${ctx.cwd}/.env`;

  const envFile = Bun.file(envPath);
  if (!(await envFile.exists())) {
    throw new EnvManagerError(
      "Project not initialized. Run 'env-manager init' first."
    );
  }

  let envContent = await envFile.text();
  let envContentChanged = false;
  let parsed = parseEnvFile(envContent);

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
  const valuesConfig = await resolveValuesConfig(ctx, envContent);
  const environment = await resolveEnvironment(ctx.cwd, {
    valuesPath: valuesConfig.format === 'ts' ? valuesConfig.path : undefined,
  });

  const existsInSchema = parsed.schema.some((s) => s.name === keyName);
  if (!existsInSchema && parseRootConfig(envContent, envPath).targets.length) {
    configError(envPath, 1, `Declare ${keyName} in a target selection before creating a key in a monorepo.`);
  }
  if (!existsInSchema) {
    console.log(`Adding ${keyName} to .env schema...`);
    envContent = appendSchemaEntry(envContent, keyName, keyDef.schemaType);
    envContentChanged = true;
  }

  await planGeneration(ctx, envContent);
  const aws = createAwsAdapter();
  const globalValue = (await readGlobalValues(aws))[keyName] ?? null;

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
      const resolveOptions = await resolveNewKeyOptions(
        keyName,
        options,
        assumeYes
      );
      key = await keyDef.resolve(ctx.project, resolveOptions);
    }
  } else {
    console.log(`Creating ${keyName}...`);
    const resolveOptions = await resolveNewKeyOptions(
      keyName,
      options,
      assumeYes
    );
    key = await keyDef.resolve(ctx.project, resolveOptions);
  }

  if (!keyDef.validate(key)) {
    throw new EnvManagerError(
      `Invalid key format. Got: ${key.slice(0, 20)}...`
    );
  }

  const localValues = await readValuesForConfig(ctx, valuesConfig);
  const localValuesChanged = localValues[keyName] !== key;
  localValues[keyName] = key;
  const updatedParsed = parseEnvFile(envContent);
  assertValid(validateEnv(updatedParsed.schema, localValues));
  await collectFilePayload(updatedParsed.schema, localValues, ctx.cwd);

  if (envContentChanged) {
    await writeManagedFile(envPath, envContent);
  }
  if (localValuesChanged) {
    await writeValuesForConfig(
      ctx,
      valuesConfig,
      updatedParsed.schema,
      localValues,
      environment,
      { project: ctx.project, version: null }
    );
  }
  await upCommand(ctx);

  if (!globalValue || key !== globalValue) {
    await saveGlobalValue(aws, keyName, key, keyDef.schemaType, ctx.project);
    console.log(`Saved ${keyName} to ${GLOBAL_LABEL}`);
  }

  console.log(`Added ${keyName} and synced ${ctx.project}/${environment} to AWS`);
}
