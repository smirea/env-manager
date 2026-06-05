import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parseHeader } from './parser';

export function readProjectNameFromEnv(cwd: string): string | null {
  let content: string;
  try {
    content = readFileSync(join(cwd, '.env'), 'utf8');
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      (error as { code?: string }).code === 'ENOENT'
    ) {
      return null;
    }
    throw error;
  }

  for (const line of content.split('\n')) {
    const header = parseHeader(line);
    if (header) {
      return header.project;
    }
  }

  return null;
}

export function resolveProjectName(
  cwd: string,
  explicitProject?: string
): string {
  if (explicitProject !== undefined) {
    return explicitProject;
  }
  return readProjectNameFromEnv(cwd) ?? basename(cwd);
}
