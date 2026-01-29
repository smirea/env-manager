import { createAwsAdapter } from "../aws";
import type { CommandContext } from "../types";

export async function listCommand(_ctx: CommandContext): Promise<void> {
  const aws = createAwsAdapter();
  const secrets = await aws.listSecrets("env-manager/");

  if (secrets.length === 0) {
    console.log("No projects found in env-manager namespace.");
    return;
  }

  console.log("Projects:");
  for (const name of secrets) {
    const project = name.replace("env-manager/", "");
    console.log(`  ${project}`);
  }
}
