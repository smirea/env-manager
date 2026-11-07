import { join } from 'node:path';
import type { RootConfig } from './config';
import { FORMATS, type OutputFormat } from './formats';
import { EnvManagerError } from './errors';
import { readText, writeManagedFile } from './files';
import { DEFAULT_ENVIRONMENT, formatHeader, readMetadata, upsertSelection, validateEnvironmentName } from './metadata';
import type { EnvValues, EnvVarSchema } from './parser';

export interface ValuesConfig {
  format: OutputFormat;
  path: string;
  selectorPath: string;
}

export interface Selection {
  recorded: string | null;
  environment: string;
  loadedFrom: string | null;
}

const ROOT_SELECTOR = '.env.local';

export function selectorFile(config: RootConfig): string {
  if (config.targets.length || !FORMATS[config.format ?? 'ts'].holdsSelection) return ROOT_SELECTOR;
  return config.path ?? FORMATS[config.format ?? 'ts'].defaultPath;
}

export function holdsSelection(config: ValuesConfig): boolean {
  return config.selectorPath === config.path;
}

export async function resolveValuesConfig(root: string, config: RootConfig): Promise<ValuesConfig> {
  if (config.targets.length) return { format: 'ts', path: ROOT_SELECTOR, selectorPath: selectorFile(config) };
  const format = config.format ?? (await Bun.file(join(root, 'package.json')).exists() ? 'ts' : undefined);
  if (!format) {
    throw new EnvManagerError(`${join(root, '.env')}:1: Values format is not configured and there is no package.json to infer ts. Run env-manager set format ts (or swift).`);
  }
  return { format, path: config.path ?? FORMATS[format].defaultPath, selectorPath: selectorFile(config) };
}

export function parseValues(format: OutputFormat, content: string): EnvValues {
  return FORMATS[format].parse(content);
}

export async function readValues(root: string, config: ValuesConfig): Promise<EnvValues> {
  return parseValues(config.format, await readText(join(root, config.path)) ?? '');
}

export function renderValues(format: OutputFormat, schema: EnvVarSchema[], values: EnvValues): string {
  return FORMATS[format].render(schema, values);
}

export function renderSourceValues(
  project: string,
  config: ValuesConfig,
  schema: EnvVarSchema[],
  values: EnvValues,
  selection: { environment: string; loadedFrom?: string }
): string {
  const body = renderValues(config.format, schema, values);
  if (!holdsSelection(config)) return body;
  const header = formatHeader('#', project, null);
  return upsertSelection(body ? `${header}\n\n${body}` : `${header}\n`, selection.environment, selection.loadedFrom);
}

export async function readSelection(root: string, config: ValuesConfig): Promise<Selection> {
  const metadata = readMetadata(await readText(join(root, config.selectorPath)) ?? '');
  if (metadata.environment !== null) validateEnvironmentName(metadata.environment);
  return {
    recorded: metadata.environment,
    environment: metadata.environment ?? DEFAULT_ENVIRONMENT,
    loadedFrom: metadata.loadedFrom,
  };
}

export async function writeSelection(root: string, config: ValuesConfig, environment: string, loadedFrom?: string): Promise<void> {
  const path = join(root, config.selectorPath);
  await writeManagedFile(path, upsertSelection(await readText(path) ?? '', environment, loadedFrom));
}

export async function writeSourceValues(root: string, project: string, config: ValuesConfig, schema: EnvVarSchema[], values: EnvValues): Promise<void> {
  const selection = await readSelection(root, config);
  const content = renderSourceValues(project, config, schema, values, {
    environment: selection.environment,
    loadedFrom: selection.loadedFrom ?? undefined,
  });
  await writeManagedFile(join(root, config.path), content);
}
