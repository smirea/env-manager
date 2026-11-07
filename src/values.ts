import { join } from 'node:path';
import { defaultValuesPath, type OutputFormat, type RootConfig } from './config';
import { EnvManagerError } from './errors';
import { readText, writeManagedFile } from './files';
import { DEFAULT_ENVIRONMENT, formatHeader, readMetadata, upsertSelection, validateEnvironmentName } from './metadata';
import { generateLocalEnvContent, parseEnvValues, type EnvValues, type EnvVarSchema } from './parser';

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

export function selectorFile(config: RootConfig): string {
  return config.targets.length || config.format === 'swift' ? '.env.local' : config.path ?? defaultValuesPath('ts');
}

export async function resolveValuesConfig(root: string, config: RootConfig): Promise<ValuesConfig> {
  if (config.targets.length) return { format: 'ts', path: '.env.local', selectorPath: selectorFile(config) };
  const format = config.format ?? (await Bun.file(join(root, 'package.json')).exists() ? 'ts' : undefined);
  if (!format) {
    throw new EnvManagerError(`${join(root, '.env')}:1: Values format is not configured and there is no package.json to infer ts. Run env-manager set format ts (or swift).`);
  }
  return { format, path: config.path ?? defaultValuesPath(format), selectorPath: selectorFile(config) };
}

export function parseValues(format: OutputFormat, content: string): EnvValues {
  return format === 'swift' ? parseSwiftValues(content) : parseEnvValues(content);
}

export async function readValues(root: string, config: ValuesConfig): Promise<EnvValues> {
  return parseValues(config.format, await readText(join(root, config.path)) ?? '');
}

export function renderValues(format: OutputFormat, schema: EnvVarSchema[], values: EnvValues): string {
  return format === 'swift' ? generateSwiftValuesContent(schema, values) : generateLocalEnvContent(schema, values);
}

export function renderSourceValues(
  project: string,
  config: ValuesConfig,
  schema: EnvVarSchema[],
  values: EnvValues,
  selection: { environment: string; loadedFrom?: string }
): string {
  const body = renderValues(config.format, schema, values);
  if (config.format === 'swift') return body;
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

export function generateSwiftValuesContent(schema: EnvVarSchema[], values: EnvValues): string {
  const schemaNames = new Set(schema.map((entry) => entry.name));
  const names = [
    ...schema.filter((entry) => Object.hasOwn(values, entry.name)).map((entry) => entry.name),
    ...Object.keys(values).filter((name) => !schemaNames.has(name)),
  ];
  return names.map((name) => `${name} = ${values[name].replaceAll('//', '/$()/')}\n`).join('');
}

export function parseSwiftValues(content: string): EnvValues {
  const values: EnvValues = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('//') || trimmed.startsWith('#')) continue;
    const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/i);
    if (!match) continue;
    const commentIdx = match[2].search(/\s+\/\//);
    values[match[1]] = (commentIdx === -1 ? match[2] : match[2].slice(0, commentIdx)).trim().replaceAll('/$()/', '//');
  }
  return values;
}

export async function writeSourceValues(root: string, project: string, config: ValuesConfig, schema: EnvVarSchema[], values: EnvValues): Promise<void> {
  const selection = await readSelection(root, config);
  const content = renderSourceValues(project, config, schema, values, {
    environment: selection.environment,
    loadedFrom: selection.loadedFrom ?? undefined,
  });
  await writeManagedFile(join(root, config.path), content);
}
