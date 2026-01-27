import { createAwsAdapter, secretName } from "../aws";
import type { CommandContext } from "../types";
import { EnvManagerError } from "../types";

const TEMPLATE = `#env-manager: {{PROJECT}} | {{DATE}}

# Add your environment variables below
# Example: API_KEY= # {string:format(/^sk-/)}
`;

export async function initCommand(ctx: CommandContext): Promise<void> {
  const envPath = `${ctx.cwd}/.env`;

  const exists = await Bun.file(envPath).exists();
  if (exists) {
    throw new EnvManagerError(
      `.env already exists at ${envPath}. Delete it first if you want to reinitialize.`
    );
  }

  const aws = createAwsAdapter(ctx.useSdk);
  const secret = await aws.getSecret(secretName(ctx.project));

  if (secret) {
    await Bun.write(envPath, secret.schema);
    if (secret.values) {
      await Bun.write(`${ctx.cwd}/.env.local`, secret.values);
    }
    console.log(`Downloaded .env from AWS for project "${ctx.project}"`);
  } else {
    const now = new Date().toISOString();
    const content = TEMPLATE.replace("{{PROJECT}}", ctx.project).replace(
      "{{DATE}}",
      now
    );
    await Bun.write(envPath, content);
    console.log(`Created new .env template for project "${ctx.project}"`);
  }
}
