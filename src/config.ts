import { isAbsolute, join, normalize } from 'node:path';
import { configError } from './errors';
import { FORMATS, isOutputFormat, OUTPUT_FORMATS, type OutputFormat } from './formats';
import { formatDirective, formatHeader, parseDirective, parseHeader } from './metadata';
import { findInlineCommentIndex, formatSchemaComment, parseEnvFile, parseEnvLine, parseSchemaComment, type EnvVarSchema, type ParsedEnvFile } from './parser';
import { validateValue } from './validator';

export type Target = {
  name: string;
  format: OutputFormat;
  path: string;
  generate?: string;
  line: number;
};
export type RootConfig = ParsedEnvFile & {
  local?: boolean;
  format?: OutputFormat;
  path?: string;
  generate?: string;
  targets: Target[];
  scopes: Map<string, string[]>;
  modern: boolean;
  metadata: Map<number, string>;
};

export const DEFAULT_READER_PATH = 'src/env.ts';

const SETTINGS = {
  local: 'local',
  format: 'format',
  path: 'path',
  generate: 'generate',
  'values.format': 'format',
  'values.path': 'path',
  ts: 'generate',
} as const;
type SettingField = keyof typeof SETTINGS;
type SettingKey = (typeof SETTINGS)[SettingField];

export const SETTING_FIELDS = Object.keys(SETTINGS) as SettingField[];

export function isSettingField(field: string): field is SettingField {
  return Object.hasOwn(SETTINGS, field);
}

export function settingKey(field: SettingField): SettingKey {
  return SETTINGS[field];
}

export function relativeOutput(value: string, file: string, line: number): string {
  if (!value || isAbsolute(value) || value.includes('\\') || /[\r\n]/.test(value) || value.includes('\0') || value.split('/').includes('..')) {
    configError(file, line, `Path "${value}" must be relative and stay inside its directory.`);
  }
  const path = normalize(value);
  if (path === '.') configError(file, line, 'Output path must name a file.');
  return path;
}


export function parseRootConfig(content: string, file = '.env', strict = false): RootConfig {
  const lines = content.split('\n');
  const settings = new Map<SettingKey, { field: SettingField; value: string; line: number }>();
  const targets: Target[] = [];
  const metadata = new Map<number, string>();
  const selections: { names: string[]; line: number }[] = [];
  const names = new Set<string>();
  let projectSeen = false;

  for (const [index, raw] of lines.entries()) {
    const line = index + 1;
    const text = raw.trim();
    if (!/^#\s*env-manager\b/.test(text)) continue;
    const header = parseHeader(text);
    if (header) {
      if (projectSeen) configError(file, line, 'Duplicate project header.');
      projectSeen = true;
      metadata.set(line, formatHeader('#', header.project, null));
      continue;
    }
    const directive = parseDirective(text);
    if (!directive?.field) configError(file, line, 'Malformed env-manager directive.');
    const { field, value } = directive;
    if (field === 'target') {
      const [name, ...fields] = value.split(/\s+/);
      if (!/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(name)) configError(file, line, `Invalid target directory "${name}".`);
      if (targets.some(t => t.name === name)) configError(file, line, `Duplicate target "${name}".`);
      const options = new Map<string, string>();
      for (const part of fields) {
        const pair = part.match(/^(format|path|generate)=(.+)$/);
        if (!pair) configError(file, line, `Unknown or malformed target field "${part}". Use format, path, generate.`);
        if (options.has(pair[1])) configError(file, line, `Duplicate target field "${pair[1]}".`);
        options.set(pair[1], pair[2]);
      }
      const format = options.get('format');
      if (!isOutputFormat(format)) configError(file, line, `Target "${name}" needs ${OUTPUT_FORMATS.map(f => `format=${f}`).join(' or ')}.`);
      if (!FORMATS[format].reader && options.has('generate')) configError(file, line, 'generate is only supported for TypeScript targets.');
      const path = relativeOutput(options.get('path') ?? FORMATS[format].defaultPath, file, line);
      const generate = FORMATS[format].reader ? relativeOutput(options.get('generate') ?? DEFAULT_READER_PATH, file, line) : undefined;
      targets.push({ name, format, path, generate, line });
      metadata.set(line, formatDirective('#', 'target', `${name} format=${format}${options.has('path') ? ` path=${path}` : ''}${options.has('generate') ? ` generate=${generate}` : ''}`));
    } else if (field === 'targets') {
      const selection = value.split(',').map(n => n.trim());
      if (selection.some(n => !n)) configError(file, line, 'Empty target selection. Use targets: * or target names.');
      if (new Set(selection).size !== selection.length) configError(file, line, 'Repeated target in selection.');
      if (selection.includes('*') && selection.length !== 1) configError(file, line, '* must be the entire selection.');
      selections.push({ names: selection, line });
      metadata.set(line, formatDirective('#', 'targets', selection.join(',')));
    } else if (field === 'env') {
      configError(file, line, 'The env directive belongs in .env.local, not the tracked .env. Run any other env-manager command to move it.');
    } else {
      if (!isSettingField(field)) configError(file, line, `Unknown env-manager field "${field}".`);
      const key = SETTINGS[field];
      if (settings.has(key)) configError(file, line, `Duplicate or conflicting "${key}" setting.`);
      if (key === 'local' && value !== 'true' && value !== 'false') configError(file, line, 'local must be true or false.');
      if (key === 'format' && !isOutputFormat(value)) configError(file, line, `format must be ${OUTPUT_FORMATS.join(' or ')}.`);
      if (key === 'path' || key === 'generate') relativeOutput(value, file, line);
      settings.set(key, { field, value, line });
      metadata.set(line, formatDirective('#', field, value));
    }
  }
  const multi = targets.length > 0;
  const modern = multi || [...settings.values()].some(s => s.field === 'format' || s.field === 'path' || s.field === 'generate');
  if (multi && (['format', 'path', 'generate'] as const).some(k => settings.has(k))) configError(file, 1, 'Target declarations cannot be mixed with single-project output settings.');
  if (!multi && selections.length) configError(file, selections[0].line, 'Declare targets before using target selections.');
  const generateSetting = settings.get('generate');
  const format = settings.get('format')?.value;
  if (isOutputFormat(format) && !FORMATS[format].reader && generateSetting?.field === 'generate') configError(file, generateSetting.line, 'generate is only supported with format: ts.');
  const selected = new Set<string>();
  for (const selection of selections) {
    if (selection.names[0] === '*') selection.names = targets.map(t => t.name);
    for (const name of selection.names) {
      if (!targets.some(t => t.name === name)) configError(file, selection.line, `Unknown target "${name}". Declare it with target: ${name} format=ts.`);
      selected.add(name);
    }
  }
  for (const target of targets) {
    if (!selected.has(target.name)) configError(file, target.line, `Target "${target.name}" is never selected. Add a targets: ${target.name} section (it may be empty).`);
  }
  const scopes = new Map<string, string[]>();
  let scope: string[] | undefined;
  for (const [index, raw] of lines.entries()) {
    const line = index + 1;
    const selection = selections.find(s => s.line === line);
    if (selection) scope = selection.names;
    const text = raw.trimStart();
    const variable = parseEnvLine(text);
    if (variable) {
      if (names.has(variable.name)) configError(file, line, `Duplicate variable "${variable.name}". Define it once and select shared targets.`);
      names.add(variable.name);
      if (multi && !scope) configError(file, line, `Select targets before defining ${variable.name}.`);
      if (scope) scopes.set(variable.name, scope);
    } else if (text.trim() && !text.startsWith('#')) {
      configError(file, line, 'Expected an environment variable assignment or comment.');
    }
    const comment = variable?.inlineComment ?? (text.startsWith('#') ? text : null);
    if (comment && /^#\s*\{/.test(comment)) {
      try {
        if (!parseSchemaComment(comment)) configError(file, line, 'Malformed schema annotation.');
      } catch (error) {
        configError(file, line, error instanceof Error ? error.message : String(error));
      }
    }
  }
  const parsed = parseEnvFile(content);
  if (strict || modern) {
    for (const name of names) {
      if (!parsed.schema.some(s => s.name === name)) {
        const line = lines.findIndex(l => parseEnvLine(l.trimStart())?.name === name) + 1;
        configError(file, line, `Variable ${name} needs a type annotation, for example # {string}.`);
      }
    }
  }
  for (const entry of parsed.schema) {
    const min = entry.validators.find(v => v.kind === 'min');
    const max = entry.validators.find(v => v.kind === 'max');
    if (min && max && min.value > max.value) configError(file, entry.lineNumber, `min() exceeds max() for ${entry.name}.`);
    const error = entry.defaultValue ? validateValue(entry, entry.defaultValue) : null;
    if (error) configError(file, entry.lineNumber, `Invalid default for ${entry.name}: ${error}`);
  }
  const setting = (key: SettingKey) => settings.get(key)?.value;
  return {
    ...parsed,
    local: settings.has('local') ? setting('local') === 'true' : undefined,
    format: format as OutputFormat | undefined,
    path: setting('path'),
    generate: setting('generate'),
    targets, scopes, modern, metadata,
  };
}

export function targetPaths(root: string, target: Target): { directory: string; values: string; reader: string | null } {
  const directory = join(root, target.name);
  return { directory, values: join(directory, target.path), reader: target.generate ? join(directory, target.generate) : null };
}

export function schemaForTarget(config: RootConfig, name: string): EnvVarSchema[] {
  return config.schema.filter(s => config.scopes.get(s.name)?.includes(name));
}

export function upsertSetting(content: string, field: SettingField, value: string): string {
  const aliases = SETTING_FIELDS.filter(alias => SETTINGS[alias] === SETTINGS[field]);
  const lines = content.split('\n');
  const existing = lines.findIndex(l => aliases.some(alias => parseDirective(l)?.field === alias));
  const comment = formatDirective('#', field, value);
  if (existing !== -1) lines[existing] = comment;
  else {
    const header = lines.findIndex(l => parseHeader(l) !== null);
    lines.splice(header === -1 ? 0 : header + 1, 0, comment);
  }
  return lines.join('\n');
}

export function formatRootConfig(content: string, file: string): string {
  const config = parseRootConfig(content, file);
  return content.split('\n').map((raw, index) => {
    if (config.metadata.has(index + 1)) return config.metadata.get(index + 1)!;
    const text = raw.trimStart();
    const variable = parseEnvLine(text);
    if (variable) {
      const rest = text.slice(text.indexOf('=') + 1);
      const commentIndex = findInlineCommentIndex(rest);
      const value = (commentIndex === -1 ? rest : rest.slice(0, commentIndex)).trim();
      const comment = variable.inlineComment;
      const schema = comment ? parseSchemaComment(comment) : null;
      return `${variable.name}=${value}${comment ? ` ${schema ? formatSchemaComment({ ...schema, name: variable.name, defaultValue: null, lineNumber: index + 1 }) : comment.trimEnd()}` : ''}`;
    }
    const schema = parseSchemaComment(text);
    return schema ? formatSchemaComment({ ...schema, name: '', defaultValue: null, lineNumber: index + 1 }) : raw;
  }).join('\n').trimEnd() + '\n';
}
