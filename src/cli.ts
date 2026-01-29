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

interface GlobalArgs {
  project: string;
}

function validateProjectName(project: string, command: string): void {
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
  describe: "Upload .env schema and .env.local values to AWS",
  handler: async (argv) => {
    validateProjectName(argv.project, "up");
    await checkAwsCredentials();
    await upCommand(createContext(argv));
  },
};

const downCmd: CommandModule<GlobalArgs, GlobalArgs> = {
  command: "down",
  describe: "Download .env and .env.local from AWS",
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
  describe: "Generate typed env.ts file",
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
  describe: "Initialize .env from AWS or create template",
  handler: async (argv) => {
    validateProjectName(argv.project, "init");
    await checkAwsCredentials();
    await initCommand(createContext(argv));
  },
};

const listCmd: CommandModule<GlobalArgs, GlobalArgs> = {
  command: "list",
  describe: "List all projects in env-manager namespace",
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
  describe: "Create and add API key (e.g., ANTHROPIC_API_KEY)",
  builder: (yargs: Argv<GlobalArgs>) =>
    yargs
      .positional("key", {
        type: "string",
        description: "Key name to create",
      })
      .option("list", {
        alias: "l",
        type: "boolean",
        default: false,
        description: "List available keys",
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
    .usage("$0 <command> [options]")
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
