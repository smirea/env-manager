#!/usr/bin/env bun

import { basename } from "path";
import { checkAwsCredentials } from "./aws";
import { downCommand } from "./commands/down";
import { initCommand } from "./commands/init";
import { listCommand } from "./commands/list";
import { newKeyCommand } from "./commands/new-key";
import { tsCommand } from "./commands/ts";
import { upCommand } from "./commands/up";
import type { CommandContext } from "./types";
import { EnvManagerError } from "./types";

const USAGE = `
env-manager - manage environment variables with AWS Secrets Manager

Commands:
  up                            Upload .env schema and .env.local values to AWS
  down                          Download .env and .env.local from AWS
  ts [path]                     Generate typed env.ts file (default: src/env.ts)
  init                          Initialize .env from AWS or create template
  list                          List all projects in env-manager namespace
  new-key <provider> [env_name] Create and add API key via provider (e.g., claude)

Options:
  -p, --project   Project name (default: current directory name)
  --sdk           Use AWS SDK instead of AWS CLI
  -h, --help      Show this help message
`;

interface ParsedArgs {
  command: string;
  project: string;
  useSdk: boolean;
  path?: string;
  args: string[];
}

function parseArgs(argv: string[]): ParsedArgs {
  let command = "";
  let project = basename(process.cwd());
  let useSdk = false;
  let path: string | undefined;
  const args: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === "-h" || arg === "--help") {
      console.log(USAGE);
      process.exit(0);
    }

    if (arg === "-p" || arg === "--project") {
      project = argv[++i];
      if (!project) {
        throw new EnvManagerError("Missing project name after -p/--project");
      }
      continue;
    }

    if (arg.startsWith("--project=")) {
      project = arg.slice("--project=".length);
      continue;
    }

    if (arg === "--sdk") {
      useSdk = true;
      continue;
    }

    if (arg.startsWith("-")) {
      throw new EnvManagerError(`Unknown option: ${arg}`);
    }

    if (!command) {
      command = arg;
    } else if (command === "ts" && !path) {
      path = arg;
    } else {
      args.push(arg);
    }
  }

  return { command, project, useSdk, path, args };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!args.command) {
    console.log(USAGE);
    process.exit(1);
  }

  const ctx: CommandContext = {
    project: args.project,
    useSdk: args.useSdk,
    cwd: process.cwd(),
  };

  const needsAws = ["up", "down", "init", "list", "new-key"].includes(args.command);
  if (needsAws) {
    await checkAwsCredentials();
  }

  switch (args.command) {
    case "up":
      await upCommand(ctx);
      break;
    case "down":
      await downCommand(ctx);
      break;
    case "ts":
      await tsCommand(ctx, args.path);
      break;
    case "init":
      await initCommand(ctx);
      break;
    case "list":
      await listCommand(ctx);
      break;
    case "new-key": {
      const provider = args.args[0];
      if (!provider) {
        throw new EnvManagerError("Provider required. Usage: env-manager new-key <provider> [env_name]");
      }
      const envName = args.args[1];
      await newKeyCommand(ctx, provider, envName);
      break;
    }
    default:
      throw new EnvManagerError(`Unknown command: ${args.command}`);
  }
}

main().catch((e) => {
  if (e instanceof EnvManagerError) {
    console.error(`Error: ${e.message}`);
  } else {
    console.error(e);
  }
  process.exit(1);
});
