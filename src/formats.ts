import type { CommentPrefix } from './metadata';
import { ENV_NAME_PATTERN, generateLocalEnvContent, parseEnvValues, type EnvValues, type EnvVarSchema } from './parser';

interface Format {
  defaultPath: string;
  commentPrefix: CommentPrefix;
  reader: boolean;
  holdsSelection: boolean;
  render(schema: EnvVarSchema[], values: EnvValues): string;
  parse(content: string): EnvValues;
}

function renderSwift(schema: EnvVarSchema[], values: EnvValues): string {
  const schemaNames = new Set(schema.map((entry) => entry.name));
  const names = [
    ...schema.filter((entry) => Object.hasOwn(values, entry.name)).map((entry) => entry.name),
    ...Object.keys(values).filter((name) => !schemaNames.has(name)),
  ];
  return names.map((name) => `${name} = ${values[name].replaceAll('//', '/$()/')}\n`).join('');
}

const SWIFT_LINE = new RegExp(`^\\s*(${ENV_NAME_PATTERN.source})\\s*=\\s*(.*?)\\s*$`, 'i');

function parseSwift(content: string): EnvValues {
  const values: EnvValues = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('//') || trimmed.startsWith('#')) continue;
    const match = line.match(SWIFT_LINE);
    if (!match) continue;
    const commentIdx = match[2].search(/\s+\/\//);
    values[match[1]] = (commentIdx === -1 ? match[2] : match[2].slice(0, commentIdx)).trim().replaceAll('/$()/', '//');
  }
  return values;
}

export const FORMATS = {
  ts: {
    defaultPath: '.env.local',
    commentPrefix: '#',
    reader: true,
    holdsSelection: true,
    render: generateLocalEnvContent,
    parse: parseEnvValues,
  },
  swift: {
    defaultPath: 'Config/LocalSecrets.xcconfig',
    commentPrefix: '//',
    reader: false,
    holdsSelection: false,
    render: renderSwift,
    parse: parseSwift,
  },
} satisfies Record<string, Format>;

export type OutputFormat = keyof typeof FORMATS;
export const OUTPUT_FORMATS = Object.keys(FORMATS) as OutputFormat[];

export function isOutputFormat(value: string | undefined): value is OutputFormat {
  return value !== undefined && Object.hasOwn(FORMATS, value);
}
