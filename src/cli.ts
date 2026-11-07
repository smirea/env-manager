#!/usr/bin/env bun

import { dirname, join, relative } from 'node:path';
import yargs, { type Argv, type ArgumentsCamelCase, type CommandModule } from 'yargs';
import { hideBin } from 'yargs/helpers';
import { checkAwsCredentials } from './aws';
import { formatRootConfig, parseRootConfig } from './config';
import { EnvManagerError, NotInitializedError } from './errors';
import { readText, withGitUpdates, writeManagedFile } from './files';
import { hasMetadata, removeSelection } from './metadata';
import { OUTPUT_FORMATS } from './formats';
import { SCHEMA_TYPES } from './parser';
import { loadProject, moveSelectionOutOfSchema, readEnvFile, type CommandContext } from './project';
import { locateProject, resolveProjectName, type ProjectLocation } from './project-root';
import { validateProjectName } from './store';
import { loadOwnEnv, resolveOwnPackageRoot } from './env-loader';
import { downCommand } from './commands/down';
import { envListCommand, envRmCommand, envSetCommand } from './commands/env';
import { generateCommand, generateFromEnvironment } from './commands/generate';
import { globalGetCommand, globalListCommand, globalRmCommand, globalSetCommand } from './commands/global';
import { infoCommand } from './commands/info';
import { initCommand } from './commands/init';
import { listCommand } from './commands/list';
import { listKeysCommand, newKeyCommand } from './commands/new-key';
import { printCommand } from './commands/print';
import { rmCommand } from './commands/rm';
import { setCommand } from './commands/set';
import { upCommand } from './commands/up';

const HELP_FOOTER = `Supported schema formats:
  Types: ${SCHEMA_TYPES.join(', ')}
  Validators: min(n), max(n), format(/regex/)
  Optional: prefix any type with "optional"
  Example: # {optional string:format(/^sk-/)}`;

type ProjectNeed = 'project' | 'named' | 'clone' | 'init' | 'none';

interface Needs {
  project: ProjectNeed;
  storage: 'required' | 'inspect' | 'unless-local' | 'none';
  readOnly?: boolean;
  local?: boolean;
}

type Args = ArgumentsCamelCase<Record<string, any>> & { local: boolean };

interface Command {
  command: string;
  describe: string;
  aliases?: string[];
  builder?: (yargs: Argv) => Argv;
  needs: Needs | ((argv: Args) => Needs);
  run: (argv: Args, ctx: CommandContext) => Promise<void>;
}

interface Group {
  command: string;
  describe: string;
  commands: Command[];
}

type NoProject = Extract<ProjectLocation, { kind: 'none' }>;

function describeSearch(location: NoProject): string {
  if (!location.repoRoot) return `${location.start} (outside a git repository only the current directory is searched)`;
  if (location.repoRoot === location.start) return location.start;
  return `${location.start} or its parents up to the repository root ${location.repoRoot}`;
}

function missingProjectError(location: NoProject, need: ProjectNeed): NotInitializedError {
  const lines = [`No env-manager setup found in ${describeSearch(location)}.`];
  for (const file of location.ignored) {
    lines.push(`${file} has no "# env-manager: <project>" header, so it is not an env-manager file.`);
  }
  const ownEnv = join(location.start, '.env');
  if (need === 'clone') lines.push(`down would overwrite ${ownEnv}. Move it away, or run env-manager init to adopt it.`);
  else if (need === 'named') lines.push('Pass --project <name>, or run env-manager init.');
  else if (location.ignored.includes(ownEnv)) lines.push('If it belongs to this project, run env-manager init to adopt it.');
  else if (location.ignored.length) lines.push(`Run env-manager init in ${dirname(location.ignored.at(-1)!)} to adopt its .env, or here to start a separate project.`);
  else lines.push('Run env-manager init.');
  return new NotInitializedError(lines.join('\n'));
}

function checkInitLocation(location: ProjectLocation): void {
  if (location.kind === 'managed') {
    if (location.root === location.start) return;
    throw new EnvManagerError([
      `Cannot init in ${location.start}: ${join(location.root, '.env')} already manages it.`,
      'Projects cannot be nested. Declare this directory as a target of that root instead:',
      `  # env-manager target: ${relative(location.root, location.start)} format=ts`,
      'then run env-manager generate from the root.',
    ].join('\n'));
  }
  if (location.repoRoot && location.repoRoot !== location.start) {
    console.warn(`Warning: initializing in ${location.start}, below the repository root ${location.repoRoot}. For subprojects of a monorepo, run env-manager init at the repository root and declare each subproject as a target.`);
  }
}

function enterProject(need: ProjectNeed, project: string | undefined): void {
  const location = locateProject(process.cwd());
  if (need === 'init') return checkInitLocation(location);
  if (location.kind === 'managed') {
    for (const file of location.ignored) console.warn(`Warning: ignoring ${file}: it has no env-manager metadata.`);
    process.chdir(location.root);
    return;
  }
  if (need === 'none') return;
  if (need === 'named' && project !== undefined) return;
  if (need === 'clone' && !location.ignored.includes(join(location.start, '.env'))) return;
  throw missingProjectError(location, need);
}

function toModule(spec: Command, prefix: string): CommandModule<any, any> {
  return {
    command: spec.command,
    describe: spec.describe,
    aliases: spec.aliases,
    builder: (y: Argv) => {
      const withBuilder = spec.builder ? spec.builder(y) : y;
      const projectScoped = typeof spec.needs === 'function' || spec.needs.project !== 'none';
      return projectScoped
        ? withBuilder.option('project', { alias: 'p', type: 'string', description: 'Project name (default: .env header, then directory name)' })
        : withBuilder;
    },
    handler: async (raw: ArgumentsCamelCase<Record<string, any>>) => {
      const argv = raw as Args;
      const name = `${prefix}${spec.command.split(' ')[0]}`;
      const needs = typeof spec.needs === 'function' ? spec.needs(argv) : spec.needs;
      enterProject(needs.project, argv.project);
      const envPath = join(process.cwd(), '.env');
      const existing = await readText(envPath);
      const content = existing !== null && hasMetadata(existing) ? existing : null;
      const config = content === null ? null : parseRootConfig(removeSelection(content), envPath);
      const local: boolean = argv.local ?? needs.local ?? config?.local === true;
      const usesStorage = needs.storage === 'required' || needs.storage === 'inspect' || (needs.storage === 'unless-local' && !local);
      if (local && (needs.storage === 'required' || needs.storage === 'inspect')) {
        throw new EnvManagerError(`${name} requires secret storage and is disabled in local mode. Use --no-local to allow it for this invocation.`);
      }
      const ctx: CommandContext = { project: resolveProjectName(process.cwd(), argv.project), cwd: process.cwd() };
      if (needs.project !== 'none' && !needs.readOnly) {
        validateProjectName(ctx.project, name, { reserved: needs.storage !== 'inspect' && needs.storage !== 'none' });
      }
      if (usesStorage) await checkAwsCredentials();
      const operation = async () => {
        if (content !== null && !needs.readOnly) await moveSelectionOutOfSchema(ctx, content);
        await spec.run({ ...argv, local }, ctx);
      };
      if (local || needs.readOnly) await operation();
      else await withGitUpdates(process.cwd(), operation);
    },
  };
}

function toGroup(group: Group): CommandModule<any, any> {
  return {
    command: group.command,
    describe: group.describe,
    builder: (y: Argv) => y
      .command(group.commands.map(spec => toModule(spec, `${group.command} `)))
      .demandCommand(1, `Please specify a ${group.command} command`)
      .strict()
      .help(),
    handler: () => {},
  };
}

const project = { project: 'project', storage: 'none' } as const;
const named = { project: 'named', storage: 'required' } as const;
const inspect = { project: 'named', storage: 'inspect' } as const;
const global = { project: 'none', storage: 'required' } as const;

function requireArg(value: string | undefined, usage: string): string {
  if (!value) throw new EnvManagerError(`Usage: env-manager ${usage}`);
  return value;
}

const generate: Command = {
  command: 'generate [path]',
  aliases: ['gen'],
  describe: 'Generate a Zod-validated env.ts from the .env schema in ts values mode',
  builder: y => y
    .positional('path', { type: 'string', description: 'Output path for generated file (default: src/env.ts)' })
    .option('target', { type: 'string', description: 'Generate only one declared target' })
    .option('force', { alias: 'f', type: 'boolean', default: false, description: 'Overwrite ts path stored in .env' })
    .option('env', { type: 'string', description: 'Render target values from this stored environment without selecting it or touching the root values' }),
  needs: argv => argv.env ? { project: 'project', storage: 'required' } : project,
  run: async (argv, ctx) => {
    if (!argv.env) return generateCommand(ctx, argv.path, { force: argv.force, target: argv.target });
    if (argv.path) throw new EnvManagerError('--env cannot be combined with a reader path.');
    await generateFromEnvironment(ctx, argv.env, { target: argv.target });
  },
};

const commands: (Command | Group)[] = [
  {
    command: 'check',
    describe: 'Validate configuration and output paths without changing files',
    builder: y => y.option('strict', { type: 'boolean', default: false, description: 'Require type annotations for legacy variables too' }),
    needs: { ...project, readOnly: true },
    run: async (argv, ctx) => {
      const content = await readEnvFile(ctx);
      parseRootConfig(content, join(ctx.cwd, '.env'), argv.strict);
      await loadProject(ctx, content);
      console.log('Configuration is valid.');
    },
  },
  {
    command: 'info',
    describe: `Print project setup as JSON: environments, targets, outputs, and variables (exit ${NotInitializedError.exitCode} without a setup)`,
    needs: { ...project, readOnly: true },
    run: (argv, ctx) => infoCommand(ctx, { local: argv.local }),
  },
  {
    command: 'format',
    describe: 'Normalize .env formatting while preserving comments, values, order, and scopes',
    needs: project,
    run: async (_argv, ctx) => {
      const project = await loadProject(ctx);
      await writeManagedFile(project.envPath, formatRootConfig(project.content, project.envPath));
      console.log('Formatted .env');
    },
  },
  {
    command: 'up',
    describe: 'Validate schema + current environment values, then upload to AWS',
    needs: { project: 'project', storage: 'required' },
    run: (_argv, ctx) => upCommand(ctx),
  },
  {
    command: 'down',
    describe: 'Download schema + current environment values from AWS and write configured files',
    builder: y => y.option('env', { type: 'string', description: 'Environment to download (defaults to the one recorded in the values file)' }),
    needs: { project: 'clone', storage: 'required' },
    run: (argv, ctx) => downCommand(ctx, { environment: argv.env }),
  },
  {
    command: 'rm [project]',
    describe: 'Delete the project secret from AWS Secrets Manager without touching local files',
    builder: y => y.positional('project', { type: 'string', description: 'Project name' }),
    needs: named,
    run: (_argv, ctx) => rmCommand(ctx),
  },
  generate,
  {
    ...generate,
    command: 'ts [path]',
    aliases: [],
    describe: 'Deprecated alias for generate (gen)',
    run: async (argv, ctx) => {
      console.warn('Warning: env-manager ts is deprecated. Use env-manager generate (gen) instead.');
      await generate.run(argv, ctx);
    },
  },
  {
    command: 'init',
    describe: 'Initialize .env from AWS if it exists, otherwise create a new template',
    builder: y => y
      .option('yes', { alias: 'y', type: 'boolean', default: false, description: 'Accept defaults for prompts' })
      .option('values-format', { type: 'string', choices: OUTPUT_FORMATS, description: 'Values output format' })
      .option('values-path', { type: 'string', description: 'Values output path' }),
    needs: { project: 'init', storage: 'unless-local' },
    run: (argv, ctx) => initCommand(ctx, {
      assumeYes: argv.yes,
      local: argv.local,
      valuesFormat: argv.valuesFormat,
      valuesPath: argv.valuesPath,
    }),
  },
  {
    command: 'list',
    aliases: ['ls'],
    describe: 'List all projects stored under the env-manager/<project> Secrets Manager namespace and global keys',
    needs: global,
    run: () => listCommand(),
  },
  {
    command: 'print [project]',
    describe: 'Print stored environments for a project',
    builder: y => y
      .positional('project', { type: 'string', description: 'Project name' })
      .option('env', { alias: 'e', type: 'string', description: 'Only print one environment' }),
    needs: inspect,
    run: (argv, ctx) => printCommand(ctx, { environment: argv.env }),
  },
  {
    command: 'set <field> <value>',
    describe: 'Set project config stored in .env',
    builder: y => y
      .positional('field', { type: 'string', description: 'Config field: local, format, path, generate (legacy values.format/values.path also work)' })
      .positional('value', { type: 'string', description: 'Config value' }),
    // Turning local mode on is itself a local-only change, so it is not committed.
    needs: argv => ({ ...project, local: argv.field === 'local' && argv.value === 'true' ? true : undefined }),
    run: (argv, ctx) => setCommand(ctx, requireArg(argv.field, 'set <field> <value>'), requireArg(argv.value, 'set <field> <value>')),
  },
  {
    command: 'env',
    describe: 'Manage project environments',
    commands: [
      {
        command: 'set <environment>',
        describe: 'Select an environment and download it (local mode only switches the selector)',
        builder: y => y.positional('environment', { type: 'string', description: 'Environment name' }),
        needs: { project: 'project', storage: 'unless-local' },
        run: (argv, ctx) => envSetCommand(ctx, requireArg(argv.environment, 'env set <environment>'), { local: argv.local }),
      },
      {
        command: 'list',
        aliases: ['ls'],
        describe: 'List environments stored for a project',
        needs: inspect,
        run: (_argv, ctx) => envListCommand(ctx),
      },
      {
        command: 'rm <environment>',
        describe: 'Remove an environment from AWS',
        builder: y => y.positional('environment', { type: 'string', description: 'Environment name' }),
        needs: named,
        run: (argv, ctx) => envRmCommand(ctx, requireArg(argv.environment, 'env rm <environment>')),
      },
    ],
  },
  {
    command: 'global',
    describe: 'Manage global defaults',
    commands: [
      {
        command: 'set [name] [value] [location]',
        describe: 'Set a global default env var',
        builder: y => y
          .positional('name', { type: 'string', description: 'Global env var name' })
          .positional('value', { type: 'string', description: 'Global env var value' })
          .positional('location', { type: 'string', description: 'Where the value was generated' })
          .option('name', { alias: 'n', type: 'string', description: 'Global env var name' })
          .option('value', { alias: 'v', type: 'string', description: 'Global env var value' })
          .option('location', { alias: 'l', type: 'string', description: 'Where the value was generated' }),
        needs: global,
        run: argv => globalSetCommand({
          name: requireArg(argv.name, 'global set <name> <value> [location]'),
          value: requireArg(argv.value, 'global set <name> <value> [location]'),
          location: argv.location,
        }),
      },
      {
        command: 'get [name]',
        describe: 'Get a global default env var',
        builder: y => y.positional('name', { type: 'string', description: 'Global env var name' }),
        needs: global,
        run: argv => globalGetCommand(argv.name),
      },
      {
        command: 'list',
        aliases: ['ls'],
        describe: 'List global default env vars',
        needs: global,
        run: () => globalListCommand(),
      },
      {
        command: 'rm [name]',
        describe: 'Remove a global default env var',
        builder: y => y
          .positional('name', { type: 'string', description: 'Global env var name' })
          .option('name', { alias: 'n', type: 'string', description: 'Global env var name' }),
        needs: global,
        run: argv => globalRmCommand(requireArg(argv.name, 'global rm <name>')),
      },
    ],
  },
  {
    command: 'new-key [key]',
    describe: 'Create or reuse a known API key, add it to the current environment, and sync to AWS',
    builder: y => y
      .positional('key', { type: 'string', description: 'Known key name to create (e.g., ANTHROPIC_API_KEY, OPENROUTER_API_KEY)' })
      .option('list', { alias: 'l', type: 'boolean', default: false, description: 'List supported keys and exit' })
      .option('yes', { alias: 'y', type: 'boolean', default: false, description: 'Accept defaults for prompts' })
      .option('name', { type: 'string', description: 'OpenRouter key display name (default: project name; OPENROUTER_API_KEY only)' })
      .option('credit', { type: 'number', description: 'OpenRouter key credit limit in USD/month (default: 10; OPENROUTER_API_KEY only)' })
      .option('unlimited', { type: 'boolean', description: 'Create OpenRouter key without a credit limit (OPENROUTER_API_KEY only)' })
      .option('expiration', { type: 'string', description: 'OpenRouter key expiration (UTC ISO-8601, e.g., 2027-12-31T23:59:59Z; OPENROUTER_API_KEY only)' }),
    needs: argv => argv.list ? { project: 'none', storage: 'none', readOnly: true } : { project: 'project', storage: 'required' },
    run: async (argv, ctx) => {
      if (argv.list) return listKeysCommand();
      const key = requireArg(argv.key, "new-key <KEY_NAME>\nRun 'env-manager new-key --list' to see available keys");
      await newKeyCommand(ctx, key, {
        assumeYes: argv.yes,
        name: argv.name,
        credit: argv.credit,
        unlimited: argv.unlimited ? true : undefined,
        expiration: argv.expiration,
      });
    },
  },
];

async function run() {
  loadOwnEnv(resolveOwnPackageRoot(import.meta.url));
  await yargs(hideBin(process.argv))
    .option('local', { type: 'boolean', description: 'Use local files only; --no-local overrides the .env setting' })
    .scriptName('env-manager')
    .usage('$0 <command> [options]\n\nManage .env schema, local values, and AWS Secrets Manager sync.')
    .command(commands.map(spec => 'commands' in spec ? toGroup(spec) : toModule(spec, '')))
    .demandCommand(1, 'Please specify a command')
    .strict()
    .fail((message, error, cli) => {
      if (error) throw error;
      cli.showHelp();
      console.error(`\n${message}`);
      process.exit(1);
    })
    .version(false)
    .epilog(HELP_FOOTER)
    .help()
    .alias('h', 'help')
    .parse();
}

run().catch((e) => {
  console.error(e instanceof EnvManagerError ? `Error: ${e.message}` : e);
  process.exit(e instanceof NotInitializedError ? NotInitializedError.exitCode : 1);
});
