#!/usr/bin/env bun

import { basename } from 'path';
import yargs, { type Argv, type CommandModule } from 'yargs';
import { hideBin } from 'yargs/helpers';
import { checkAwsCredentials } from './aws';
import { downCommand } from './commands/down';
import {
  envListCommand,
  envRmCommand,
  envSetCommand,
} from './commands/env';
import {
  globalGetCommand,
  globalListCommand,
  globalRmCommand,
  globalSetCommand,
} from './commands/global';
import { initCommand } from './commands/init';
import { listCommand } from './commands/list';
import { listKeysCommand, newKeyCommand } from './commands/new-key';
import { printCommand } from './commands/print';
import { tsCommand } from './commands/ts';
import { upCommand } from './commands/up';
import { loadOwnEnvFromPaths, resolveOwnEnvPaths } from './env-loader';
import type { CommandContext } from './types';
import { EnvManagerError } from './types';

const RESERVED_PROJECT_NAMES = ['default', 'global'];
const PROJECT_NAME_PATTERN = /^[^\s|]+$/;
const SUPPORTED_SCHEMA_TYPES = [
  'string',
  'int',
  'float',
  'bool',
  'url',
  'email',
  'file',
];
const SUPPORTED_SCHEMA_VALIDATORS = ['min(n)', 'max(n)', 'format(/regex/)'];
const HELP_FOOTER = `Supported schema formats:
  Types: ${SUPPORTED_SCHEMA_TYPES.join(", ")}
  Validators: ${SUPPORTED_SCHEMA_VALIDATORS.join(", ")}
  Optional: prefix any type with "optional"
  Example: # {optional string:format(/^sk-/)}`;

interface ProjectArgs {
  project: string;
}

function withProjectOption<T>(yargs: Argv<T>): Argv<T & ProjectArgs> {
  return yargs.option("project", {
    alias: "p",
    type: "string",
    default: basename(process.cwd()),
    description: "Project name",
  }) as Argv<T & ProjectArgs>;
}

function validateProjectName(project: string, command: string): void {
  if (!PROJECT_NAME_PATTERN.test(project)) {
    throw new EnvManagerError(
      `Invalid project name "${project}". Project names cannot include spaces or "|".`
    );
  }
  const commandsRestrictingDefault = ['up', 'down', 'init', 'env'];
  if (
    commandsRestrictingDefault.includes(command) &&
    RESERVED_PROJECT_NAMES.includes(project)
  ) {
    throw new EnvManagerError(
      `"${project}" is a reserved project name and cannot be used with ${command}`
    );
  }
}

function createContext(argv: ProjectArgs): CommandContext {
  return {
    project: argv.project,
    cwd: process.cwd(),
  };
}

const upCmd: CommandModule<any, any> = {
  command: "up",
  describe:
    "Validate schema + current environment values, then upload to AWS",
  builder: (yargs: Argv<Record<string, never>>) =>
    withProjectOption(yargs) as Argv<ProjectArgs>,
  handler: async (argv) => {
    const args = argv as unknown as ProjectArgs;
    validateProjectName(args.project, "up");
    await checkAwsCredentials();
    await upCommand(createContext(args));
  },
};

const downCmd: CommandModule<any, any> = {
  command: "down",
  describe:
    "Download schema + current environment values from AWS and write .env/.env.local files",
  builder: (yargs: Argv<Record<string, never>>) =>
    withProjectOption(yargs) as Argv<ProjectArgs>,
  handler: async (argv) => {
    const args = argv as unknown as ProjectArgs;
    validateProjectName(args.project, 'down');
    await checkAwsCredentials();
    await downCommand(createContext(args));
  },
};

interface TsArgs extends ProjectArgs {
  path?: string;
  force: boolean;
}

const tsCmd: CommandModule<any, any> = {
  command: "ts [path]",
  describe:
    "Generate a Zod-validated env.ts from the .env schema for typed access",
  builder: (yargs: Argv<Record<string, never>>) =>
    withProjectOption(
      yargs
        .positional("path", {
          type: "string",
          description: "Output path for generated file (default: src/env.ts)",
        })
        .option("force", {
          alias: "f",
          type: "boolean",
          default: false,
          description: "Overwrite ts path stored in .env",
        })
    ) as Argv<TsArgs>,
  handler: async (argv) => {
    const args = argv as unknown as TsArgs;
    await tsCommand(createContext(args), args.path, { force: args.force });
  },
};

interface InitArgs extends ProjectArgs {
  yes: boolean;
}

const initCmd: CommandModule<any, any> = {
  command: "init",
  describe:
    "Initialize .env from AWS if it exists, otherwise create a new template",
  builder: (yargs: Argv<Record<string, never>>) =>
    withProjectOption(
      yargs.option("yes", {
        alias: "y",
        type: "boolean",
        default: false,
        description: "Accept defaults for prompts",
      })
    ) as Argv<InitArgs>,
  handler: async (argv) => {
    const args = argv as unknown as InitArgs;
    validateProjectName(args.project, 'init');
    await checkAwsCredentials();
    await initCommand(createContext(args), { assumeYes: args.yes });
  },
};

const listCmd: CommandModule<any, any> = {
  command: "list",
  aliases: ["ls"],
  describe:
    "List all projects stored under the env-manager/<project> Secrets Manager namespace and global keys",
  handler: async () => {
    await checkAwsCredentials();
    await listCommand();
  },
};

interface PrintArgs {
  project?: string;
  env?: string;
}

const printCmd: CommandModule<any, any> = {
  command: 'print [project]',
  describe: 'Print stored environments for a project',
  builder: (yargs: Argv<Record<string, never>>) =>
    yargs
      .positional('project', {
        type: 'string',
        description: 'Project name',
      })
      .option('project', {
        alias: 'p',
        type: 'string',
        description: 'Project name',
      })
      .option('env', {
        alias: 'e',
        type: 'string',
        description: 'Only print one environment',
      }) as Argv<PrintArgs>,
  handler: async (argv) => {
    const args = argv as PrintArgs;
    const project = args.project ?? basename(process.cwd());
    validateProjectName(project, 'print');
    await checkAwsCredentials();
    await printCommand(createContext({ project }), { environment: args.env });
  },
};

interface EnvNameArgs extends ProjectArgs {
  environment?: string;
}

const envSetCmd: CommandModule<any, any> = {
  command: 'set <environment>',
  describe: 'Set the default environment stored in .env.local',
  builder: (yargs: Argv<Record<string, never>>) =>
    yargs.positional('environment', {
      type: 'string',
      description: 'Environment name',
    }) as unknown as Argv<EnvNameArgs>,
  handler: async (argv) => {
    const args = argv as unknown as EnvNameArgs;
    if (!args.environment) {
      throw new EnvManagerError('Usage: env-manager env set <environment>');
    }
    validateProjectName(args.project, 'env');
    await envSetCommand(createContext(args), args.environment);
  },
};

const envListCmd: CommandModule<any, any> = {
  command: 'list',
  aliases: ['ls'],
  describe: 'List environments stored for a project',
  handler: async (argv) => {
    const args = argv as unknown as ProjectArgs;
    validateProjectName(args.project, 'env');
    await checkAwsCredentials();
    await envListCommand(createContext(args));
  },
};

const envRmCmd: CommandModule<any, any> = {
  command: 'rm <environment>',
  describe: 'Remove an environment from AWS',
  builder: (yargs: Argv<Record<string, never>>) =>
    yargs.positional('environment', {
      type: 'string',
      description: 'Environment name',
    }) as unknown as Argv<EnvNameArgs>,
  handler: async (argv) => {
    const args = argv as unknown as EnvNameArgs;
    if (!args.environment) {
      throw new EnvManagerError('Usage: env-manager env rm <environment>');
    }
    validateProjectName(args.project, 'env');
    await checkAwsCredentials();
    await envRmCommand(createContext(args), args.environment);
  },
};

const envCmd: CommandModule<any, any> = {
  command: 'env',
  describe: 'Manage project environments',
  builder: (yargs: Argv<Record<string, never>>) =>
    withProjectOption(
      yargs
        .command(envSetCmd)
        .command(envListCmd)
        .command(envRmCmd)
        .demandCommand(1, 'Please specify an env command')
        .strict()
        .help()
    ) as Argv<ProjectArgs>,
  handler: () => {},
};

interface GlobalGetArgs {
  name?: string;
}

interface GlobalSetArgs {
  name?: string;
  value?: string;
  location?: string;
}

function parseGlobalSetInput(argv: GlobalSetArgs): {
  name: string;
  value: string;
  location?: string;
} {
  const rawArgs = hideBin(process.argv);
  const globalIndex = rawArgs.indexOf('global');
  let setIndex = rawArgs.indexOf('set');
  if (globalIndex !== -1 && rawArgs[globalIndex + 1] === 'set') {
    setIndex = globalIndex + 1;
  }
  const argsAfter = setIndex === -1 ? rawArgs : rawArgs.slice(setIndex + 1);

  let flagsUsed = false;
  const positional: string[] = [];
  const consumeFlagValue = (arg: string): boolean =>
    arg === "-n" ||
    arg === "--name" ||
    arg === "-v" ||
    arg === "--value" ||
    arg === "-l" ||
    arg === "--location";

  for (let i = 0; i < argsAfter.length; i++) {
    const arg = argsAfter[i];
    if (arg === '--') {
      positional.push(...argsAfter.slice(i + 1));
      break;
    }
    if (arg.startsWith('--')) {
      if (
        arg.startsWith('--name=') ||
        arg.startsWith('--value=') ||
        arg.startsWith('--location=')
      ) {
        flagsUsed = true;
        continue;
      }
      if (consumeFlagValue(arg)) {
        flagsUsed = true;
        i++;
        continue;
      }
      continue;
    }
    if (arg.startsWith('-')) {
      if (consumeFlagValue(arg)) {
        flagsUsed = true;
        i++;
        continue;
      }
      continue;
    }
    positional.push(arg);
  }

  if (flagsUsed && positional.length > 0) {
    throw new EnvManagerError(
      "Use either flags (-n/-v/-l) or positional args, not both."
    );
  }

  if (!flagsUsed && positional.length !== 2 && positional.length !== 3) {
    throw new EnvManagerError(
      "Usage: env-manager global set <name> <value> [location]"
    );
  }

  const name = flagsUsed ? argv.name : positional[0];
  const value = flagsUsed ? argv.value : positional[1];
  const location = flagsUsed ? argv.location : positional[2];

  if (flagsUsed && (!value || !name || !location)) {
    throw new EnvManagerError(
      "Usage: env-manager global set -n <name> -v <value> -l <location>"
    );
  }

  if (!name || !value) {
    throw new EnvManagerError(
      "Usage: env-manager global set <name> <value> [location]"
    );
  }

  return { name, value, location };
}

const globalSetCmd: CommandModule<any, any> = {
  command: "set [name] [value] [location]",
  describe: "Set a global default env var",
  builder: (yargs: Argv<Record<string, never>>) =>
    yargs
      .positional("name", {
        type: "string",
        description: "Global env var name",
      })
      .positional("value", {
        type: "string",
        description: "Global env var value",
      })
      .positional("location", {
        type: "string",
        description: "Where the value was generated",
      })
      .option("name", {
        alias: "n",
        type: "string",
        description: "Global env var name",
      })
      .option("value", {
        alias: "v",
        type: "string",
        description: "Global env var value",
      })
      .option("location", {
        alias: "l",
        type: "string",
        description: "Where the value was generated",
      }) as Argv<GlobalSetArgs>,
  handler: async (argv) => {
    await checkAwsCredentials();
    const input = parseGlobalSetInput(argv as GlobalSetArgs);
    await globalSetCommand(createContext({ project: 'default' }), input);
  },
};

const globalGetCmd: CommandModule<any, any> = {
  command: "get [name]",
  describe: "Get a global default env var",
  builder: (yargs: Argv<Record<string, never>>) =>
    yargs.positional("name", {
      type: "string",
      description: "Global env var name",
    }) as Argv<GlobalGetArgs>,
  handler: async (argv) => {
    await checkAwsCredentials();
    await globalGetCommand(createContext({ project: 'default' }), argv.name);
  },
};

const globalListCmd: CommandModule<any, any> =
  {
    command: "list",
    aliases: ["ls"],
    describe: "List global default env vars",
    handler: async () => {
      await checkAwsCredentials();
      await globalListCommand(createContext({ project: 'default' }));
    },
  };

interface GlobalRmArgs {
  name?: string;
}

const globalRmCmd: CommandModule<any, any> = {
  command: "rm [name]",
  describe: "Remove a global default env var",
  builder: (yargs: Argv<Record<string, never>>) =>
    yargs
      .positional("name", {
        type: "string",
        description: "Global env var name",
      })
      .option("name", {
        alias: "n",
        type: "string",
        description: "Global env var name",
      })
      .demandOption("name", "Name required") as Argv<GlobalRmArgs>,
  handler: async (argv) => {
    if (!argv.name) {
      throw new EnvManagerError('Usage: env-manager global rm <name>');
    }
    await checkAwsCredentials();
    await globalRmCommand(createContext({ project: "default" }), argv.name);
  },
};

const globalCmd: CommandModule<any, any> = {
  command: "global",
  describe: "Manage global defaults",
  builder: (yargs: Argv<Record<string, never>>) =>
    yargs
      .command(globalSetCmd)
      .command(globalGetCmd)
      .command(globalListCmd)
      .command(globalRmCmd)
      .demandCommand(1, "Please specify a global command")
      .strict()
      .help(),
  handler: () => {},
};

interface NewKeyArgs extends ProjectArgs {
  key?: string;
  list: boolean;
  yes: boolean;
  name?: string;
  credit?: number;
  unlimited?: boolean;
  expiration?: string;
}

const newKeyCmd: CommandModule<any, any> = {
  command: "new-key [key]",
  describe:
    "Create or reuse a known API key, add it to the current environment, and sync to AWS",
  builder: (yargs: Argv<Record<string, never>>) =>
    withProjectOption(
      yargs
        .positional("key", {
          type: "string",
          description:
            "Known key name to create (e.g., ANTHROPIC_API_KEY, OPENROUTER_API_KEY)",
        })
        .option("list", {
          alias: "l",
          type: "boolean",
          default: false,
          description: "List supported keys and exit",
        })
        .option("yes", {
          alias: "y",
          type: "boolean",
          default: false,
          description: "Accept defaults for prompts",
        })
        .option("name", {
          type: "string",
          description:
            "OpenRouter key display name (default: project name; OPENROUTER_API_KEY only)",
        })
        .option("credit", {
          type: "number",
          description:
            "OpenRouter key credit limit in USD/month (default: 10; OPENROUTER_API_KEY only)",
        })
        .option("unlimited", {
          type: "boolean",
          description:
            "Create OpenRouter key without a credit limit (OPENROUTER_API_KEY only)",
        })
        .option("expiration", {
          type: "string",
          description:
            "OpenRouter key expiration (UTC ISO-8601, e.g., 2027-12-31T23:59:59Z; OPENROUTER_API_KEY only)",
        })
    ) as unknown as Argv<NewKeyArgs>,
  handler: async (argv) => {
    const args = argv as unknown as NewKeyArgs;
    if (argv.list) {
      listKeysCommand();
      return;
    }
    if (!args.key) {
      throw new EnvManagerError(
        "Key name required. Usage: env-manager new-key <KEY_NAME>\nRun 'env-manager new-key --list' to see available keys"
      );
    }
    await checkAwsCredentials();
    await newKeyCommand(createContext(args), args.key, {
      assumeYes: args.yes,
      name: args.name,
      credit: args.credit,
      unlimited: args.unlimited ? true : undefined,
      expiration: args.expiration,
    });
  },
};

async function run() {
  loadOwnEnvFromPaths(resolveOwnEnvPaths(import.meta.url));
  const rootCommands: Array<CommandModule<any, any>> = [
    upCmd,
    downCmd,
    tsCmd,
    initCmd,
    listCmd,
    printCmd,
    envCmd,
    globalCmd,
    newKeyCmd,
  ];
  await yargs(hideBin(process.argv))
    .scriptName('env-manager')
    .usage(
      '$0 <command> [options]\n\nManage .env schema, local values, and AWS Secrets Manager sync.'
    )
    .command(rootCommands as Array<CommandModule<{}, any>>)
    .demandCommand(1, 'Please specify a command')
    .strict()
    .version(false)
    .epilog(HELP_FOOTER)
    .help()
    .alias('h', 'help')
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
