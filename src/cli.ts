#!/usr/bin/env bun

import { basename } from "path";
import yargs, { type Argv, type CommandModule } from "yargs";
import { hideBin } from "yargs/helpers";
import { checkAwsCredentials } from "./aws";
import { downCommand } from "./commands/down";
import { initCommand } from "./commands/init";
import { listCommand } from "./commands/list";
import { listKeysCommand, newKeyCommand } from "./commands/new-key";
import { tsCommand } from "./commands/ts";
import { upCommand } from "./commands/up";
import type { CommandContext } from "./types";
import { EnvManagerError } from "./types";

const RESERVED_PROJECT_NAMES = ["default"];
const PROJECT_NAME_PATTERN = /^[^\s|]+$/;
const SUPPORTED_SCHEMA_TYPES = [
  "string",
  "int",
  "float",
  "bool",
  "url",
  "email",
  "file",
];
const SUPPORTED_SCHEMA_VALIDATORS = ["min(n)", "max(n)", "format(/regex/)"];
const HELP_FOOTER = `Supported schema formats:
  Types: ${SUPPORTED_SCHEMA_TYPES.join(", ")}
  Validators: ${SUPPORTED_SCHEMA_VALIDATORS.join(", ")}
  Optional: prefix any type with "optional"
  Example: # {optional string:format(/^sk-/)}`;

interface GlobalArgs {
  project: string;
}

function validateProjectName(project: string, command: string): void {
  if (!PROJECT_NAME_PATTERN.test(project)) {
    throw new EnvManagerError(
      `Invalid project name "${project}". Project names cannot include spaces or "|".`
    );
  }
  const commandsRestrictingDefault = ["up", "down", "init"];
  if (
    commandsRestrictingDefault.includes(command) &&
    RESERVED_PROJECT_NAMES.includes(project)
  ) {
    throw new EnvManagerError(
      `"${project}" is a reserved project name and cannot be used with ${command}`
    );
  }
}

function createContext(argv: GlobalArgs): CommandContext {
  return {
    project: argv.project,
    cwd: process.cwd(),
  };
}

const upCmd: CommandModule<GlobalArgs, GlobalArgs> = {
  command: "up",
  describe:
    "Validate schema + values, then upload .env schema, .env.local values, and file payloads to AWS",
  handler: async (argv) => {
    validateProjectName(argv.project, "up");
    await checkAwsCredentials();
    await upCommand(createContext(argv));
  },
};

const downCmd: CommandModule<GlobalArgs, GlobalArgs> = {
  command: "down",
  describe:
    "Download schema + values from AWS, validate them, and write .env/.env.local files",
  handler: async (argv) => {
    validateProjectName(argv.project, "down");
    await checkAwsCredentials();
    await downCommand(createContext(argv));
  },
};

interface TsArgs extends GlobalArgs {
  path: string;
}

const tsCmd: CommandModule<GlobalArgs, TsArgs> = {
  command: "ts [path]",
  describe:
    "Generate a Zod-validated env.ts from the .env schema for typed access",
  builder: (yargs: Argv<GlobalArgs>) =>
    yargs.positional("path", {
      type: "string",
      default: "src/env.ts",
      description: "Output path for generated file",
    }) as Argv<TsArgs>,
  handler: async (argv) => {
    await tsCommand(createContext(argv), argv.path);
  },
};

const initCmd: CommandModule<GlobalArgs, GlobalArgs> = {
  command: "init",
  describe:
    "Initialize .env from AWS if it exists, otherwise create a new template",
  handler: async (argv) => {
    validateProjectName(argv.project, "init");
    await checkAwsCredentials();
    await initCommand(createContext(argv));
  },
};

const listCmd: CommandModule<GlobalArgs, GlobalArgs> = {
  command: "list",
  describe:
    "List all projects stored under the env-manager/<project> Secrets Manager namespace",
  handler: async (argv) => {
    await checkAwsCredentials();
    await listCommand(createContext(argv));
  },
};

interface NewKeyArgs extends GlobalArgs {
  key?: string;
  list: boolean;
}

const newKeyCmd: CommandModule<GlobalArgs, NewKeyArgs> = {
  command: "new-key [key]",
  describe:
    "Create or reuse a known API key, add it to .env/.env.local, and sync to AWS",
  builder: (yargs: Argv<GlobalArgs>) =>
    yargs
      .positional("key", {
        type: "string",
        description: "Known key name to create (e.g., ANTHROPIC_API_KEY)",
      })
      .option("list", {
        alias: "l",
        type: "boolean",
        default: false,
        description: "List supported keys and exit",
      }) as Argv<NewKeyArgs>,
  handler: async (argv) => {
    if (argv.list) {
      listKeysCommand();
      return;
    }
    if (!argv.key) {
      throw new EnvManagerError(
        "Key name required. Usage: env-manager new-key <KEY_NAME>\nRun 'env-manager new-key --list' to see available keys"
      );
    }
    await checkAwsCredentials();
    await newKeyCommand(createContext(argv), argv.key);
  },
};

async function run() {
  await yargs(hideBin(process.argv))
    .scriptName("env-manager")
    .usage(
      "$0 <command> [options]\n\nManage .env schema, local values, and AWS Secrets Manager sync."
    )
    .option("project", {
      alias: "p",
      type: "string",
      default: basename(process.cwd()),
      description: "Project name",
    })
    .command(upCmd)
    .command(downCmd)
    .command(tsCmd)
    .command(initCmd)
    .command(listCmd)
    .command(newKeyCmd)
    .demandCommand(1, "Please specify a command")
    .strict()
    .version(false)
    .epilog(HELP_FOOTER)
    .help()
    .alias("h", "help")
    .parse();
}

run().catch((e) => {
  if (e instanceof EnvManagerError) {
    console.error(`Error: ${e.message}`);
  } else {
    console.error(e);
  }
  process.exit(1);
});
