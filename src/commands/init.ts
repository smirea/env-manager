import { createAwsAdapter, secretName } from "../aws";
import {
  removeEnvironmentFromContent,
  resolveEnvironment,
} from "../environment";
import { writeFilesFromPayload } from "../file-sync";
import { GLOBAL_LABEL, GLOBAL_PROJECT } from "../global";
import { parseEnvFile, parseEnvValues } from "../parser";
import { normalizeProjectSecret } from "../project-secret";
import { promptLine } from "../prompt";
import type { CommandContext, EnvVarSchema } from "../types";
import { EnvManagerError } from "../types";
import { assertValid, validateEnv } from "../validator";
import {
  createValuesConfig,
  readValuesForConfig,
  resolveValuesConfig,
  type ValuesConfig,
  upsertValuesConfig,
  writeValuesForConfig,
} from "../values-config";

const TEMPLATE = `# env-manager: {{PROJECT}} | {{DATE}}

# Add your environment variables below
# Example: API_KEY= # {string:format(/^sk-/)}
`;

type InitOptions = {
  assumeYes?: boolean;
  valuesFormat?: string;
  valuesPath?: string;
};

async function promptYesNo(
  question: string,
  assumeYes: boolean
): Promise<boolean> {
  if (assumeYes) {
    return true;
  }
  if (!process.stdin.isTTY) {
    throw new EnvManagerError(
      "Non-interactive shell detected. Re-run with --yes to accept defaults."
    );
  }
  let prompt = `${question} (Y/n): `;
  while (true) {
    const answer = (await promptLine(prompt)).trim().toLowerCase();
    if (answer === "" || answer === "y" || answer === "yes") {
      return true;
    }
    if (answer === "n" || answer === "no") {
      return false;
    }
    prompt = "Please answer Y or n: ";
  }
}

type CopyGlobalDefaultsParams = {
  aws: ReturnType<typeof createAwsAdapter>;
  ctx: CommandContext;
  valuesConfig: ValuesConfig;
  assumeYes: boolean;
  environment: string;
  restrictToNames: Set<string> | null;
  localSchema: EnvVarSchema[];
  project: string;
};

function collectEnvVarNames(content: string): string[] {
  const names = new Set<string>();
  const values = parseEnvValues(content);
  for (const name of Object.keys(values)) {
    names.add(name);
  }
  const parsed = parseEnvFile(content);
  for (const entry of parsed.schema) {
    names.add(entry.name);
  }
  return Array.from(names);
}

async function copyGlobalDefaults({
  aws,
  ctx,
  valuesConfig,
  assumeYes,
  environment,
  restrictToNames,
  localSchema,
  project,
}: CopyGlobalDefaultsParams): Promise<void> {
  const globalSecret = await aws.getSecret(secretName(GLOBAL_PROJECT));
  if (!globalSecret?.values) {
    return;
  }

  const globalValues = parseEnvValues(globalSecret.values);
  const globalParsed = parseEnvFile(globalSecret.schema);
  let candidateNames = globalParsed.schema.map((s) => s.name);

  if (candidateNames.length === 0) {
    return;
  }

  if (restrictToNames) {
    candidateNames = candidateNames.filter((name) =>
      restrictToNames.has(name)
    );
    if (candidateNames.length === 0) {
      if (restrictToNames.size === 0) {
        console.log(
          `\nNo variables declared in .env to match with ${GLOBAL_LABEL}.`
        );
      } else {
        console.log(
          `\nNo overlapping keys between .env and ${GLOBAL_LABEL}.`
        );
      }
      return;
    }
  }

  const matchLabel = restrictToNames ? " matching your .env" : "";
  console.log(
    `\nFound ${candidateNames.length} key(s) in ${GLOBAL_LABEL}${matchLabel}:`
  );
  for (const name of candidateNames) {
    console.log(`  - ${name}`);
  }
  console.log();

  const localValues = await readValuesForConfig(ctx, valuesConfig);

  let copiedAny = false;
  for (const name of candidateNames) {
    const value = globalValues[name];
    if (!value) continue;

    const useIt = await promptYesNo(
      `Use ${name} from ${GLOBAL_LABEL}?`,
      assumeYes
    );
    if (useIt && localValues[name] !== value) {
      localValues[name] = value;
      copiedAny = true;
      console.log(`  Added ${name}`);
    }
  }

  if (copiedAny) {
    await writeValuesForConfig(
      ctx,
      valuesConfig,
      localSchema,
      localValues,
      environment,
      {
        project,
        syncDate: new Date().toISOString(),
      }
    );
    console.log(`\nCopied selected keys to ${valuesConfig.path}`);
  }
}

function getInitValuesConfig(options: InitOptions): ValuesConfig | null {
  const hasFormat = options.valuesFormat !== undefined;
  const hasPath = options.valuesPath !== undefined;

  if (!hasFormat && !hasPath) {
    return null;
  }

  if (!options.valuesFormat || !options.valuesPath) {
    throw new EnvManagerError(
      'Use --values-format and --values-path together.'
    );
  }

  return createValuesConfig(options.valuesFormat, options.valuesPath);
}

export async function initCommand(
  ctx: CommandContext,
  options: InitOptions = {}
): Promise<void> {
  const assumeYes = options.assumeYes === true;
  const initValuesConfig = getInitValuesConfig(options);
  const envPath = `${ctx.cwd}/.env`;
  const envFile = Bun.file(envPath);
  const envAlreadyExists = await envFile.exists();
  const aws = createAwsAdapter();
  let envContent = envAlreadyExists ? await envFile.text() : "";

  if (!envAlreadyExists) {
    const secret = await aws.getSecret(secretName(ctx.project));

    if (secret) {
      const projectSecret = normalizeProjectSecret(secret);
      const schemaContent = initValuesConfig
        ? upsertValuesConfig(projectSecret.schema, initValuesConfig)
        : projectSecret.schema;
      const valuesConfig = await resolveValuesConfig(ctx, schemaContent);
      const environment = await resolveEnvironment(ctx.cwd, {
        valuesPath: valuesConfig.format === 'ts' ? valuesConfig.path : undefined,
      });
      const envPayload = projectSecret.environments[environment];
      if (!envPayload) {
        throw new EnvManagerError(
          `Environment "${environment}" not found for project "${ctx.project}"`
        );
      }

      const parsed = parseEnvFile(schemaContent);
      const values = parseEnvValues(envPayload.values);
      const result = validateEnv(parsed.schema, values);
      assertValid(result);
      await writeFilesFromPayload(
        parsed.schema,
        values,
        envPayload.files,
        ctx.cwd
      );
      await Bun.write(envPath, schemaContent);
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
      console.log(
        `Downloaded .env from AWS for project "${ctx.project}" environment "${environment}"`
      );
      return;
    }
  } else {
    const envContentWithoutEnvironment = removeEnvironmentFromContent(envContent);
    if (envContentWithoutEnvironment !== envContent) {
      envContent = envContentWithoutEnvironment;
      await Bun.write(envPath, envContent);
    }
    if (initValuesConfig) {
      envContent = upsertValuesConfig(envContent, initValuesConfig);
      await Bun.write(envPath, envContent);
    }
    console.log(`.env already exists at ${envPath}, skipping creation.`);
  }

  let restrictToNames: Set<string> | null = null;
  if (envAlreadyExists) {
    const names = collectEnvVarNames(envContent);
    restrictToNames = new Set(names);
  } else {
    const now = new Date().toISOString();
    envContent = TEMPLATE.replace("{{PROJECT}}", ctx.project).replace(
      "{{DATE}}",
      now
    );
    if (initValuesConfig) {
      envContent = upsertValuesConfig(envContent, initValuesConfig);
    }
    await resolveValuesConfig(ctx, envContent);
    await Bun.write(envPath, envContent);
    console.log(`Created new .env template for project "${ctx.project}"`);
  }
  const valuesConfig = await resolveValuesConfig(ctx, envContent);
  const environment = await resolveEnvironment(ctx.cwd, {
    valuesPath: valuesConfig.format === 'ts' ? valuesConfig.path : undefined,
  });
  const localSchema = parseEnvFile(envContent).schema;

  await copyGlobalDefaults({
    aws,
    ctx,
    valuesConfig,
    assumeYes,
    environment,
    restrictToNames,
    localSchema,
    project: ctx.project,
  });
}
