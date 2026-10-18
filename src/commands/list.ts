import { createAwsAdapter } from "../aws";
import { GLOBAL_PROJECT } from "../global";
import { readGlobalValues } from "./global";

export async function listCommand(): Promise<void> {
  const aws = createAwsAdapter();
  const secrets = await aws.listSecrets("env-manager/");

  const projectNames = secrets
    .map((name) => name.replace("env-manager/", ""))
    .filter((name) => name !== GLOBAL_PROJECT);

  if (projectNames.length === 0) {
    console.log("No projects found in env-manager namespace.");
  } else {
    console.log("Projects:");
    for (const name of projectNames) {
      console.log(`  ${name}`);
    }
  }

  const globalKeys = Object.keys(await readGlobalValues(aws)).sort();

  console.log("");
  console.log("Global defaults:");
  if (globalKeys.length === 0) {
    console.log("  (none)");
    return;
  }
  for (const key of globalKeys) {
    console.log(`  ${key}`);
  }
}
