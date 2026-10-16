import { formatHeaderLine, parseHeader } from './parser';
import type { OutputVersion, OutputVersions } from './types';

const HEADER_PATTERN = /^(?:#|\/\/)\s*env-manager:/;
const RECORD_LINE_PATTERN = /^(?:#|\/\/)\s*env-manager output:/;
const RECORD_PATTERN = /^(?:#|\/\/)\s*env-manager output:\s*(\S+)\s+v(\d+)\s+([0-9a-f]+)\s*$/;

export type CommentPrefix = '#' | '//';

export function hashContent(content: string): string {
  return new Bun.CryptoHasher('sha256').update(content).digest('hex').slice(0, 16);
}

export function formatPrefixedHeader(prefix: CommentPrefix, project: string, version: number | null): string {
  return formatHeaderLine({ project, version }).replace(/^#/, prefix);
}

export function readFileVersion(content: string): number | null {
  const line = content.split('\n').find(l => HEADER_PATTERN.test(l));
  return line ? parseHeader(line.replace(/^\/\//, '#'))?.version ?? null : null;
}

export function parseVersionRecord(content: string): OutputVersions {
  const record: OutputVersions = {};
  for (const line of content.split('\n')) {
    const match = line.match(RECORD_PATTERN);
    if (match) record[match[1]] = { version: Number(match[2]), hash: match[3] };
  }
  return record;
}

export function versionRecordsEqual(left: OutputVersions, right: OutputVersions): boolean {
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length
    && keys.every(key => left[key].version === right[key]?.version && left[key].hash === right[key]?.hash);
}

// Prefers a known version whose hash matches. With no history for the key, a file
// identical to the new content keeps its version so a fresh checkout does not rewrite it.
export function resolveVersion(
  key: string,
  hash: string,
  candidates: (OutputVersions | undefined)[],
  file: { version: number | null; unchanged: boolean }
): OutputVersion {
  const entries = candidates.map(c => c?.[key]).filter((e): e is OutputVersion => !!e);
  const match = entries.filter(e => e.hash === hash).sort((a, b) => b.version - a.version)[0];
  if (match) return match;
  const date = new Date().toISOString();
  if (!entries.length && file.unchanged && file.version !== null) return { version: file.version, hash, date };
  return { version: Math.max(file.version ?? 0, ...entries.map(e => e.version)) + 1, hash, date };
}

export function upsertSourceMetadata(
  content: string,
  prefix: CommentPrefix,
  project: string,
  version: number,
  record: OutputVersions
): string {
  const lines = content.split('\n').filter(line => !RECORD_LINE_PATTERN.test(line));
  const metadata = [
    formatPrefixedHeader(prefix, project, version),
    ...Object.keys(record).sort().map(key => `${prefix} env-manager output: ${key} v${record[key].version} ${record[key].hash}`),
  ];
  const headerIdx = lines.findIndex(line => HEADER_PATTERN.test(line));
  if (headerIdx === -1) lines.unshift(...metadata);
  else lines.splice(headerIdx, 1, ...metadata);
  return lines.join('\n');
}
