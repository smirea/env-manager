import { createAwsAdapter, secretName } from "../aws";
import { writeFilesFromPayload } from "../file-sync";
import { GLOBAL_LABEL, GLOBAL_PROJECT } from "../global";
import {
  generateLocalEnvContent,
  parseEnvFile,
  parseEnvValues,
} from "../parser";
import { promptLine } from "../prompt";
import type { CommandContext, EnvVarSchema } from "../types";
import { EnvManagerError } from "../types";
import { assertValid, validateEnv } from "../validator";

const TEMPLATE = `#env-manager: {{PROJECT}} | {{DATE}}

# Add your environment variables below
# Example: API_KEY= # {string:format(/^sk-/)}
`;

type InitOptions = {
  assumeYes?: boolean;
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
  localPath: string;
  assumeYes: boolean;
  restrictToNames: Set<string> | null;
  localSchema: EnvVarSchema[];
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
  localPath,
  assumeYes,
  restrictToNames,
  localSchema,
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

  let localValues: Record<string, string> = {};
  const localFile = Bun.file(localPath);
  if (await localFile.exists()) {
    localValues = parseEnvValues(await localFile.text());
  }

  let copiedAny = false;
  for (const name of candidateNames) {
    const value = globalValues[name];
    if (!value) continue;

    const useIt = await promptYesNo(
      `Use ${name} from ${GLOBAL_LABEL}?`,
      assumeYes
    );
    if (useIt) {
      localValues[name] = value;
      copiedAny = true;
      console.log(`  Added ${name}`);
    }
  }

  if (copiedAny) {
    const localContent = generateLocalEnvContent(localSchema, localValues);
    await Bun.write(localPath, localContent);
    console.log(`\nCopied selected keys to .env.local`);
  }
}

export async function initCommand(
  ctx: CommandContext,
  options: InitOptions = {}
): Promise<void> {
  const assumeYes = options.assumeYes === true;
  const envPath = `${ctx.cwd}/.env`;
  const localPath = `${ctx.cwd}/.env.local`;
  const envFile = Bun.file(envPath);
  const envAlreadyExists = await envFile.exists();
  const aws = createAwsAdapter();
  let envContent = envAlreadyExists ? await envFile.text() : "";

  if (!envAlreadyExists) {
    const secret = await aws.getSecret(secretName(ctx.project));

    if (secret) {
      const parsed = parseEnvFile(secret.schema);
      const values = parseEnvValues(secret.values ?? "");
      const result = validateEnv(parsed.schema, values);
      assertValid(result);
      await writeFilesFromPayload(
        parsed.schema,
        values,
        secret.files,
        ctx.cwd
      );
      await Bun.write(envPath, secret.schema);
      if (secret.values) {
        await Bun.write(
          localPath,
          generateLocalEnvContent(parsed.schema, values)
        );
      }
      console.log(`Downloaded .env from AWS for project "${ctx.project}"`);
      return;
    }
  } else {
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
    await Bun.write(envPath, envContent);
    console.log(`Created new .env template for project "${ctx.project}"`);
  }
  const localSchema = parseEnvFile(envContent).schema;

  await copyGlobalDefaults({
    aws,
    localPath,
    assumeYes,
    restrictToNames,
    localSchema,
  });
}
