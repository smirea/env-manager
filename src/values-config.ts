import { mkdir } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { upsertEnvironmentInContent } from './environment';
import { generateLocalEnvContent, parseEnvValues } from './parser';
import type {
  CommandContext,
  EnvFileHeader,
  EnvValues,
  EnvVarSchema,
} from './types';
import { EnvManagerError } from './types';

export type ValuesFormat = 'ts' | 'swift';
export type ValuesConfigField = 'values.format' | 'values.path';

export interface ValuesConfig {
  format: ValuesFormat;
  path: string;
}

const VALUES_FORMAT_PREFIX = '# env-manager values.format: ';
const VALUES_PATH_PREFIX = '# env-manager values.path: ';
const DEFAULT_TS_VALUES_CONFIG: ValuesConfig = {
  format: 'ts',
  path: '.env.local',
};

export const VALUES_CONFIG_FIELDS: ValuesConfigField[] = [
  'values.format',
  'values.path',
];

export function parseValuesConfig(content: string): Partial<ValuesConfig> {
  const config: Partial<ValuesConfig> = {};

  for (const line of content.split('\n')) {
    const formatMatch = line.match(
      /^#\s*env-manager values\.format:\s*(.*?)\s*$/
    );
    if (formatMatch) {
      config.format = normalizeValuesFormat(formatMatch[1]);
      continue;
    }

    const pathMatch = line.match(
      /^#\s*env-manager values\.path:\s*(.*?)\s*$/
    );
    if (pathMatch) {
      config.path = normalizeValuesPath(pathMatch[1]);
    }
  }

  return config;
}

export async function resolveValuesConfig(
  ctx: CommandContext,
  envContent: string
): Promise<ValuesConfig> {
  const config = parseValuesConfig(envContent);

  if (config.format && config.path) {
    return {
      format: config.format,
      path: config.path,
    };
  }

  if (config.format || config.path) {
    throw new EnvManagerError(
      '.env has an incomplete values config. Set both values.format and values.path.'
    );
  }

  if (await Bun.file(join(ctx.cwd, 'package.json')).exists()) {
    return { ...DEFAULT_TS_VALUES_CONFIG };
  }

  console.warn(
    [
      'Warning: package.json not found, so env-manager could not infer the values format.',
      'Configure Swift values, for example:',
      '  env-manager set values.format swift && env-manager set values.path Config/LocalSecrets.xcconfig',
    ].join('\n')
  );
  throw new EnvManagerError(
    'Values output is not configured.'
  );
}

export function normalizeValuesConfigField(field: string): ValuesConfigField {
  const normalized = field.trim();
  if (normalized === 'format' || normalized === 'values.format') {
    return 'values.format';
  }
  if (normalized === 'path' || normalized === 'values.path') {
    return 'values.path';
  }
  throw new EnvManagerError(
    `Unknown field "${field}". Supported fields: ${VALUES_CONFIG_FIELDS.join(', ')}`
  );
}

export function createValuesConfig(format: string, path: string): ValuesConfig {
  return {
    format: normalizeValuesFormat(format),
    path: normalizeValuesPath(path),
  };
}

export function upsertValuesConfig(
  content: string,
  config: ValuesConfig
): string {
  return upsertValuesConfigField(
    upsertValuesConfigField(content, 'values.format', config.format),
    'values.path',
    config.path
  );
}

export function upsertValuesConfigField(
  content: string,
  field: ValuesConfigField,
  value: string
): string {
  const normalizedValue =
    field === 'values.format'
      ? normalizeValuesFormat(value)
      : normalizeValuesPath(value);
  const prefix =
    field === 'values.format' ? VALUES_FORMAT_PREFIX : VALUES_PATH_PREFIX;
  const pattern =
    field === 'values.format'
      ? /^#\s*env-manager values\.format:/
      : /^#\s*env-manager values\.path:/;
  const comment = `${prefix}${normalizedValue}`;
  const lines = content.split('\n');
  const existingIdx = lines.findIndex((line) => pattern.test(line));

  if (existingIdx !== -1) {
    lines[existingIdx] = comment;
    return lines.join('\n');
  }

  const insertIdx = findMetadataInsertIndex(lines);
  if (insertIdx !== -1) {
    lines.splice(insertIdx, 0, comment);
    return lines.join('\n');
  }

  return `${comment}\n${content}`;
}

export function resolveValuesOutputPath(
  ctx: CommandContext,
  config: ValuesConfig
): string {
  return isAbsolute(config.path) ? config.path : join(ctx.cwd, config.path);
}

export async function readValuesForConfig(
  ctx: CommandContext,
  config: ValuesConfig
): Promise<EnvValues> {
  const valuesFile = Bun.file(resolveValuesOutputPath(ctx, config));
  if (!(await valuesFile.exists())) {
    return {};
  }

  const content = await valuesFile.text();
  return config.format === 'swift'
    ? parseSwiftValues(content)
    : parseEnvValues(content);
}

export async function writeValuesForConfig(
  ctx: CommandContext,
  config: ValuesConfig,
  schema: EnvVarSchema[],
  values: EnvValues,
  environment: string,
  header: EnvFileHeader
): Promise<void> {
  const outputPath = resolveValuesOutputPath(ctx, config);
  await ensureParentDirectory(outputPath);

  const content =
    config.format === 'swift'
      ? generateSwiftValuesContent(schema, values)
      : upsertEnvironmentInContent(
          generateLocalEnvContent(schema, values, header),
          environment
        );

  await Bun.write(outputPath, content);
}

export function generateSwiftValuesContent(
  schema: EnvVarSchema[],
  values: EnvValues
): string {
  const lines: string[] = [];
  const schemaNames = new Set(schema.map((entry) => entry.name));
  const emitted = new Set<string>();

  for (const entry of schema) {
    if (!Object.prototype.hasOwnProperty.call(values, entry.name)) {
      continue;
    }
    lines.push(`${entry.name} = ${values[entry.name]}`);
    emitted.add(entry.name);
  }

  for (const [name, value] of Object.entries(values)) {
    if (emitted.has(name) || schemaNames.has(name)) {
      continue;
    }
    lines.push(`${name} = ${value}`);
  }

  return lines.length === 0 ? '' : `${lines.join('\n')}\n`;
}

export function parseSwiftValues(content: string): EnvValues {
  const values: EnvValues = {};

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (
      trimmed === '' ||
      trimmed.startsWith('//') ||
      trimmed.startsWith('#')
    ) {
      continue;
    }

    const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/i);
    if (!match) {
      continue;
    }

    values[match[1]] = stripSwiftInlineComment(match[2]).trim();
  }

  return values;
}

function normalizeValuesFormat(value: string): ValuesFormat {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'ts' || normalized === 'swift') {
    return normalized;
  }
  throw new EnvManagerError(
    `Unsupported values.format "${value}". Supported formats: ts, swift`
  );
}

function normalizeValuesPath(value: string): string {
  const normalized = value.trim();
  if (normalized === '') {
    throw new EnvManagerError('values.path cannot be empty.');
  }
  if (normalized.includes('\n') || normalized.includes('\r')) {
    throw new EnvManagerError('values.path cannot contain newlines.');
  }
  return normalized;
}

function findMetadataInsertIndex(lines: string[]): number {
  const headerIdx = lines.findIndex((line) => /^#\s*env-manager:/.test(line));
  if (headerIdx === -1) {
    return -1;
  }

  let insertIdx = headerIdx + 1;
  while (/^#\s*env-manager\s/.test(lines[insertIdx] ?? '')) {
    insertIdx++;
  }
  return insertIdx;
}

async function ensureParentDirectory(path: string): Promise<void> {
  const dir = dirname(path);
  if (dir === '.' || dir === path) {
    return;
  }
  await mkdir(dir, { recursive: true });
}

function stripSwiftInlineComment(value: string): string {
  const commentIdx = value.search(/\s+\/\//);
  return commentIdx === -1 ? value : value.slice(0, commentIdx);
}
