import { parseEnvFile, parseEnvLine, parseHeader, parseSchemaComment, formatSchemaComment, findInlineCommentIndex } from './parser';
import { validateEnv } from './validator';
import { EnvManagerError, type ParsedEnvFile, type EnvVarSchema } from './types';
import { isAbsolute, normalize } from 'node:path';

export type OutputFormat = 'ts' | 'swift';
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

export function configError(file: string, line: number, message: string): never {
  throw new EnvManagerError(`${file}:${line}: ${message}`);
}

export function relativeOutput(value: string, file: string, line: number): string {
  if (!value || isAbsolute(value) || value.includes('\\') || (/[\r\n]/.test(value) || value.includes(String.fromCharCode(0))) || value.split('/').includes('..')) {
    configError(file, line, `Path "${value}" must be relative and stay inside its directory.`);
  }
  const path = normalize(value);
  if (path === '.') configError(file, line, 'Output path must name a file.');
  return path;
}

export function defaultValuesPath(format: OutputFormat): string {
  return format === 'swift' ? 'Config/LocalSecrets.xcconfig' : '.env.local';
}

export function parseRootConfig(content: string, file = '.env', strict = false): RootConfig {
  const lines = content.split('\n');
  const settings = new Map<string, { value: string; line: number }>();
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
      metadata.set(line, `# env-manager: ${header.project}${header.syncDate ? ` | ${header.syncDate}` : ''}`);
      continue;
    }
    const match = text.match(/^#\s*env-manager\s+([\w.]+)\s*:\s*(.*?)\s*$/);
    if (!match) configError(file, line, 'Malformed env-manager directive.');
    const [, field, value] = match;
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
      if (format !== 'ts' && format !== 'swift') configError(file, line, `Target "${name}" needs format=ts or format=swift.`);
      if (format === 'swift' && options.has('generate')) configError(file, line, 'generate is only supported for TypeScript targets.');
      const path = relativeOutput(options.get('path') ?? defaultValuesPath(format), file, line);
      const generate = format === 'ts' ? relativeOutput(options.get('generate') ?? 'src/env.ts', file, line) : undefined;
      targets.push({ name, format, path, generate, line });
      metadata.set(line, `# env-manager target: ${name} format=${format}${options.has('path') ? ` path=${path}` : ''}${options.has('generate') ? ` generate=${generate}` : ''}`);
    } else if (field === 'targets') {
      const selection = value.split(',').map(n => n.trim());
      if (selection.some(n => !n)) configError(file, line, 'Empty target selection. Use targets: * or target names.');
      if (new Set(selection).size !== selection.length) configError(file, line, 'Repeated target in selection.');
      if (selection.includes('*') && selection.length !== 1) configError(file, line, '* must be the entire selection.');
      selections.push({ names: selection, line });
      metadata.set(line, `# env-manager targets: ${selection.join(',')}`);
    } else {
      if (!['local', 'format', 'path', 'generate', 'values.format', 'values.path', 'ts', 'env'].includes(field)) {
        configError(file, line, `Unknown env-manager field "${field}".`);
      }
      const key = ({ 'values.format': 'format', 'values.path': 'path', ts: 'generate' } as Record<string, string>)[field] ?? field;
      if (settings.has(key)) configError(file, line, `Duplicate or conflicting "${key}" setting.`);
      if (field === 'local' && value !== 'true' && value !== 'false') configError(file, line, 'local must be true or false.');
      if (key === 'format' && value !== 'ts' && value !== 'swift') configError(file, line, 'format must be ts or swift.');
      if (key === 'path' || key === 'generate') relativeOutput(value, file, line);
      if (key === 'env' && !/^[^\s|]+$/.test(value)) configError(file, line, 'Invalid environment name.');
      settings.set(key, { value, line });
      metadata.set(line, `# env-manager ${field}: ${value}`);
    }
  }
  const multi = targets.length > 0;
  const modern = multi || lines.some(l => /^#\s*env-manager\s+(format|path|generate)\s*:/.test(l.trim()));
  if (multi && ['format', 'path', 'generate'].some(k => settings.has(k))) configError(file, 1, 'Target declarations cannot be mixed with single-project output settings.');
  if (!multi && selections.length) configError(file, selections[0].line, 'Declare targets before using target selections.');
  if (settings.get('format')?.value === 'swift' && metadata.get(settings.get('generate')?.line ?? 0)?.startsWith('# env-manager generate:')) configError(file, settings.get('generate')!.line, 'generate is only supported with format: ts.');
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
  const strictTypes = strict || modern;
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
  if (strictTypes) {
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
    if (min?.kind === 'min' && max?.kind === 'max' && min.value > max.value) configError(file, entry.lineNumber, `min() exceeds max() for ${entry.name}.`);
    if (entry.defaultValue !== null && entry.defaultValue !== '') {
      const result = validateEnv([entry], {});
      if (!result.valid) configError(file, entry.lineNumber, `Invalid default for ${entry.name}: ${result.errors[0].message}`);
    }
  }
  return {
    ...parsed, local: settings.has('local') ? settings.get('local')!.value === 'true' : undefined,
    format: settings.get('format')?.value as OutputFormat | undefined,
    path: settings.get('path')?.value, generate: settings.get('generate')?.value,
    targets, scopes, modern, metadata,
  };
}

export function schemaForTarget(config: RootConfig, name: string): EnvVarSchema[] {
  return config.schema.filter(s => config.scopes.get(s.name)?.includes(name));
}

export function upsertSetting(content: string, field: string, value: string): string {
  const aliases = field === 'format' ? ['format', 'values.format'] : field === 'path' ? ['path', 'values.path'] : field === 'generate' ? ['generate', 'ts'] : [field];
  const lines = content.split('\n');
  const existing = lines.findIndex(l => aliases.some(a => new RegExp(`^#\\s*env-manager\\s+${a.replace('.', '\\.')}\\s*:`).test(l)));
  const comment = `# env-manager ${field}: ${value}`;
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
      const equals = text.indexOf('=');
      const rest = text.slice(equals + 1);
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
