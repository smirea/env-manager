import { EnvManagerError } from './errors';

export type CommentPrefix = '#' | '//';

export const DEFAULT_ENVIRONMENT = 'local';

export interface OutputVersion {
  version: number;
  hash: string;
  date?: string;
}

export type OutputVersions = Record<string, OutputVersion>;

export interface FileMetadata {
  project: string | null;
  version: number | null;
  target: string | null;
  root: string | null;
  environment: string | null;
  loadedFrom: string | null;
  outputs: OutputVersions;
}

const LINE_PATTERN = /^(#|\/\/)\s*env-manager(\s+(?:values env|[\w.]+))?\s*:\s*(.*?)\s*$/;
const HEADER_PATTERN = /^([^\s|]+)(?:\s*\|\s*(.+))?$/;
const OUTPUT_PATTERN = /^(\S+)\s+v(\d+)\s+([0-9a-f]+)$/;
export const NAME_PATTERN = /^[^\s|]+$/;

export function validateEnvironmentName(environment: string): void {
  if (!NAME_PATTERN.test(environment)) {
    throw new EnvManagerError(`Invalid environment "${environment}". Environment names cannot include spaces or "|".`);
  }
}

export function parseDirective(line: string): { prefix: CommentPrefix; field: string; value: string } | null {
  const match = line.trim().match(LINE_PATTERN);
  return match ? { prefix: match[1] as CommentPrefix, field: match[2]?.trim() ?? '', value: match[3] } : null;
}

export function formatDirective(prefix: CommentPrefix, field: string, value: string): string {
  return `${prefix} env-manager ${field}: ${value}`;
}

export function hasMetadata(content: string): boolean {
  return /^(?:#|\/\/)\s*env-manager\b/m.test(content);
}

// Anything after "|" that is not a version is a legacy sync date and is dropped.
export function parseHeader(line: string): { project: string; version: number | null } | null {
  const parsed = parseDirective(line);
  const match = parsed?.field === '' ? parsed.value.match(HEADER_PATTERN) : null;
  if (!match) return null;
  const version = match[2]?.trim().match(/^v(\d+)$/)?.[1];
  return { project: match[1], version: version === undefined ? null : Number(version) };
}

export function readMetadata(content: string): FileMetadata {
  const metadata: FileMetadata = {
    project: null, version: null, target: null, root: null, environment: null, loadedFrom: null, outputs: {},
  };
  let headerSeen = false;
  for (const line of content.split('\n')) {
    const parsed = parseDirective(line);
    if (!parsed) continue;
    const { field, value } = parsed;
    if (field === '' && !headerSeen) {
      const header = parseHeader(line);
      if (!header) continue;
      headerSeen = true;
      metadata.project = header.project;
      metadata.version = header.version;
    } else if (field === 'target') {
      metadata.target ??= value.match(/^\S+$/) ? value : null;
    } else if (field === 'root') {
      metadata.root ??= value || null;
    } else if (field === 'env') {
      metadata.environment ??= value;
    } else if (field === 'values env') {
      metadata.loadedFrom ??= value || null;
    } else if (field === 'output') {
      const match = value.match(OUTPUT_PATTERN);
      if (match) metadata.outputs[match[1]] = { version: Number(match[2]), hash: match[3] };
    }
  }
  return metadata;
}

export function formatHeader(prefix: CommentPrefix, project: string, version: number | null): string {
  return `${prefix} env-manager: ${project}${version === null ? '' : ` | v${version}`}`;
}

function isHeader(line: string): boolean {
  return parseHeader(line) !== null;
}

function isField(line: string, field: string): boolean {
  return parseDirective(line)?.field === field;
}

export function setHeaderVersion(content: string, version: number | null): string {
  const lines = content.split('\n');
  const index = lines.findIndex(isHeader);
  if (index !== -1) lines[index] = formatHeader('#', parseHeader(lines[index])!.project, version);
  return lines.join('\n');
}

export function ensureHeader(content: string, project: string): string {
  if (content.split('\n').some(isHeader)) return setHeaderVersion(content, null);
  return `${formatHeader('#', project, null)}\n\n${content.trim() === '' ? '' : content}`;
}

export function removeSelection(content: string): string {
  return content.split('\n').filter(line => !isField(line, 'env')).join('\n');
}

export function upsertSelection(content: string, environment: string, loadedFrom?: string): string {
  validateEnvironmentName(environment);
  const comment = formatDirective('#', 'env', environment);
  let lines = content.split('\n');
  const existing = lines.findIndex(line => isField(line, 'env'));
  if (existing !== -1) lines[existing] = comment;
  else {
    const header = lines.findIndex(isHeader);
    if (header === -1) lines.unshift(comment);
    else lines.splice(header + 1, 0, comment);
  }
  if (loadedFrom === undefined) return lines.join('\n');
  validateEnvironmentName(loadedFrom);
  lines = lines.filter(line => !isField(line, 'values env'));
  lines.splice(lines.findIndex(line => isField(line, 'env')) + 1, 0, formatDirective('#', 'values env', loadedFrom));
  return lines.join('\n');
}

export function upsertSourceMetadata(
  content: string,
  prefix: CommentPrefix,
  project: string,
  version: number,
  record: OutputVersions
): string {
  const lines = content.split('\n').filter(line => !isField(line, 'output'));
  const metadata = [
    formatHeader(prefix, project, version),
    ...Object.keys(record).sort().map(key => formatDirective(prefix, 'output', `${key} v${record[key].version} ${record[key].hash}`)),
  ];
  const header = lines.findIndex(isHeader);
  if (header === -1) lines.unshift(...metadata);
  else lines.splice(header, 1, ...metadata);
  return lines.join('\n');
}

export function formatOwnership(
  prefix: CommentPrefix,
  owner: { project: string; version: number | null; target: string; root: string; environment: string | null }
): string {
  return [
    formatHeader(prefix, owner.project, owner.version),
    formatDirective(prefix, 'target', owner.target),
    formatDirective(prefix, 'root', owner.root),
    ...owner.environment === null ? [] : [formatDirective(prefix, 'env', owner.environment)],
    '',
  ].join('\n');
}

export function metadataLines(content: string): string[] {
  return content.split('\n').filter(line => parseDirective(line) !== null);
}
