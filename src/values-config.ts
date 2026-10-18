import { parseRootConfig, defaultValuesPath, type OutputFormat } from './config';
import { writeManagedFile } from './git-updates';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { upsertEnvironmentInContent } from './environment';
import { generateLocalEnvContent, parseEnvValues } from './parser';
import type {
  CommandContext,
  EnvFileHeader,
  EnvValues,
  EnvVarSchema,
} from './types';
import { EnvManagerError } from './types';

export interface ValuesConfig {
  format: OutputFormat;
  path: string;
}

export async function resolveValuesConfig(
  ctx: CommandContext,
  envContent: string
): Promise<ValuesConfig> {
  const root = parseRootConfig(envContent, join(ctx.cwd, '.env'));
  if (root.targets.length) return { format: 'ts', path: '.env.local' };
  const config = { format: root.format, path: root.path };
  if (root.modern) {
    const format = config.format ?? (await Bun.file(join(ctx.cwd, 'package.json')).exists() ? 'ts' : undefined);
    if (!format) throw new EnvManagerError(`${ctx.cwd}/.env:1: Set format: ts or format: swift.`);
    return { format, path: config.path ?? defaultValuesPath(format) };
  }

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
    return { format: 'ts', path: defaultValuesPath('ts') };
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

export function resolveValuesOutputPath(
  ctx: CommandContext,
  config: ValuesConfig
): string {
  return join(ctx.cwd, config.path);
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
  await mkdir(dirname(outputPath), { recursive: true });

  const content =
    config.format === 'swift'
      ? generateSwiftValuesContent(schema, values)
      : upsertEnvironmentInContent(
          generateLocalEnvContent(schema, values, header),
          environment
        );

  await writeManagedFile(outputPath, content);
}

export function generateSwiftValuesContent(
  schema: EnvVarSchema[],
  values: EnvValues
): string {
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

    values[match[1]] = stripSwiftInlineComment(match[2]).trim().replaceAll('/$()/', '//');
  }

  return values;
}

function stripSwiftInlineComment(value: string): string {
  const commentIdx = value.search(/\s+\/\//);
  return commentIdx === -1 ? value : value.slice(0, commentIdx);
}
