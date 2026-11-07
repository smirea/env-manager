import { join, relative } from 'node:path';
import { parseRootConfig, type RootConfig } from './config';
import { configError, NotInitializedError } from './errors';
import { readText, writeManagedFile } from './files';
import { readMetadata, removeSelection, upsertSelection } from './metadata';
import { preflightPaths } from './output-paths';
import { planOutputs, type PlannedOutput } from './outputs';
import { resolveValuesConfig, selectorFile, type ValuesConfig } from './values';

export interface CommandContext {
  project: string;
  cwd: string;
}

export interface Project {
  name: string;
  root: string;
  envPath: string;
  content: string;
  config: RootConfig;
  values: ValuesConfig;
  outputs: PlannedOutput[];
}

export function parseProjectConfig(ctx: CommandContext, content: string): RootConfig {
  const envPath = join(ctx.cwd, '.env');
  const config = parseRootConfig(content, envPath);
  if (config.project && config.project !== ctx.project) configError(envPath, 1, `.env project "${config.project}" does not match --project "${ctx.project}".`);
  return config;
}

export async function readEnvFile(ctx: CommandContext): Promise<string> {
  const envPath = join(ctx.cwd, '.env');
  const content = await readText(envPath);
  if (content === null) throw new NotInitializedError(`No env-manager setup: ${envPath} does not exist. Run env-manager init.`);
  return content;
}

export async function loadProject(ctx: CommandContext, content?: string): Promise<Project> {
  const envPath = join(ctx.cwd, '.env');
  const text = content ?? await readEnvFile(ctx);
  const config = parseProjectConfig(ctx, text);
  const values = await resolveValuesConfig(ctx.cwd, config);
  const outputs = planOutputs(ctx.cwd, config, values);
  await preflightPaths(ctx.cwd, ctx.project, outputs, values.path);
  return { name: ctx.project, root: ctx.cwd, envPath, content: text, config, values, outputs };
}

// The env directive used to live in the tracked .env; an existing one in the values file wins.
export async function moveSelectionOutOfSchema(ctx: CommandContext, content: string): Promise<void> {
  const environment = readMetadata(content).environment;
  if (!environment) return;
  const envPath = join(ctx.cwd, '.env');
  const schema = removeSelection(content);
  const selectorPath = join(ctx.cwd, selectorFile(parseRootConfig(schema, envPath)));
  const selector = await readText(selectorPath) ?? '';
  if (!readMetadata(selector).environment) await writeManagedFile(selectorPath, upsertSelection(selector, environment));
  await writeManagedFile(envPath, schema);
  console.log(`Moved env "${environment}" from .env to ${relative(ctx.cwd, selectorPath)}`);
}
