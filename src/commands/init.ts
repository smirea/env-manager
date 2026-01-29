import { createAwsAdapter, secretName } from "../aws";
import { writeFilesFromPayload } from "../file-sync";
import { parseEnvFile, parseEnvValues, setEnvValue } from "../parser";
import type { CommandContext } from "../types";
import { EnvManagerError } from "../types";
import { assertValid, validateEnv } from "../validator";

const DEFAULT_PROJECT = "default";

const TEMPLATE = `#env-manager: {{PROJECT}} | {{DATE}}

# Add your environment variables below
# Example: API_KEY= # {string:format(/^sk-/)}
`;

async function promptYesNo(question: string): Promise<boolean> {
  process.stdout.write(`${question} (Y/n): `);

  for await (const line of console) {
    const answer = line.trim().toLowerCase();
    if (answer === "" || answer === "y" || answer === "yes") {
      return true;
    }
    if (answer === "n" || answer === "no") {
      return false;
    }
    process.stdout.write("Please answer Y or n: ");
  }
  return false;
}

export async function initCommand(ctx: CommandContext): Promise<void> {
  const envPath = `${ctx.cwd}/.env`;
  const localPath = `${ctx.cwd}/.env.local`;

  const exists = await Bun.file(envPath).exists();
  if (exists) {
    throw new EnvManagerError(
      `.env already exists at ${envPath}. Delete it first if you want to reinitialize.`
    );
  }

  const aws = createAwsAdapter();
  const secret = await aws.getSecret(secretName(ctx.project));

  if (secret) {
    const parsed = parseEnvFile(secret.schema);
    const values = parseEnvValues(secret.values ?? "");
    const result = validateEnv(parsed.schema, values);
    assertValid(result);
    await writeFilesFromPayload(parsed.schema, values, secret.files, ctx.cwd);
    await Bun.write(envPath, secret.schema);
    if (secret.values) {
      await Bun.write(localPath, secret.values);
    }
    console.log(`Downloaded .env from AWS for project "${ctx.project}"`);
    return;
  }

  const now = new Date().toISOString();
  const content = TEMPLATE.replace("{{PROJECT}}", ctx.project).replace(
    "{{DATE}}",
    now
  );
  await Bun.write(envPath, content);
  console.log(`Created new .env template for project "${ctx.project}"`);

  const defaultSecret = await aws.getSecret(secretName(DEFAULT_PROJECT));
  if (!defaultSecret?.values) {
    return;
  }

  const defaultValues = parseEnvValues(defaultSecret.values);
  const defaultParsed = parseEnvFile(defaultSecret.schema);
  const defaultVarNames = defaultParsed.schema.map((s) => s.name);

  if (defaultVarNames.length === 0) {
    return;
  }

  console.log(`\nFound ${defaultVarNames.length} key(s) in /default:`);
  for (const name of defaultVarNames) {
    console.log(`  - ${name}`);
  }
  console.log();

  let localContent = "";
  const localFile = Bun.file(localPath);
  if (await localFile.exists()) {
    localContent = await localFile.text();
  }

  let copiedAny = false;
  for (const name of defaultVarNames) {
    const value = defaultValues[name];
    if (!value) continue;

    const useIt = await promptYesNo(`Use ${name} from /default?`);
    if (useIt) {
      localContent = setEnvValue(localContent, name, value);
      copiedAny = true;
      console.log(`  Added ${name}`);
    }
  }

  if (copiedAny) {
    await Bun.write(localPath, localContent);
    console.log(`\nCopied selected keys to .env.local`);
  }
}
