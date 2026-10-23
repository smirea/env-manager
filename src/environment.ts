import { join, resolve } from 'node:path';
import { writeManagedFile } from './git-updates';
import { EnvManagerError } from './types';

export const DEFAULT_ENVIRONMENT = 'local';

const ENV_COMMENT_PREFIX = '# env-manager env: ';
const ENV_NAME_PATTERN = /^[^\s|]+$/;
const VALUES_ENV_PREFIX = '# env-manager values env: ';
const VALUES_ENV_PATTERN = /^#\s*env-manager values env:/;

type ResolveEnvironmentOptions = {
  valuesPath?: string;
};

export function validateEnvironmentName(environment: string): void {
  if (!ENV_NAME_PATTERN.test(environment)) {
    throw new EnvManagerError(
      `Invalid environment "${environment}". Environment names cannot include spaces or "|".`
    );
  }
}

export function parseEnvironmentComment(line: string): string | null {
  const match = line.match(/^#\s*env-manager env:\s*(.*?)\s*$/);
  if (!match) {
    return null;
  }
  const environment = match[1].trim();
  validateEnvironmentName(environment);
  return environment;
}

export function findEnvironmentInContent(content: string): string | null {
  for (const line of content.split('\n')) {
    const environment = parseEnvironmentComment(line);
    if (environment) {
      return environment;
    }
  }
  return null;
}

// An existing env in the values file wins over the one being moved out of .env.
export async function moveEnvironmentToValuesFile(
  cwd: string,
  valuesPath: string,
  environment: string
): Promise<void> {
  const path = join(cwd, valuesPath);
  const file = Bun.file(path);
  const content = (await file.exists()) ? await file.text() : '';
  if (findEnvironmentInContent(content)) return;
  await writeManagedFile(path, upsertEnvironmentInContent(content, environment));
}

async function readSelector(cwd: string, options: ResolveEnvironmentOptions): Promise<string | null> {
  const candidates = new Set(options.valuesPath ? [options.valuesPath, '.env.local'] : ['.env.local']);
  for (const candidate of candidates) {
    const localFile = Bun.file(resolve(cwd, candidate));
    if (await localFile.exists()) return localFile.text();
  }
  return null;
}

export async function findEnvironment(
  cwd: string,
  options: ResolveEnvironmentOptions = {}
): Promise<string | null> {
  const content = await readSelector(cwd, options);
  return content === null ? null : findEnvironmentInContent(content);
}

// Records which environment the values file was loaded from (down) or created for
// (env set seeding a new one). `env set` in local mode only moves the selector, so
// a mismatch means the file still holds another environment's values.
export async function findValuesEnvironment(
  cwd: string,
  options: ResolveEnvironmentOptions = {}
): Promise<string | null> {
  const content = await readSelector(cwd, options);
  return content === null ? null : findValuesEnvironmentInContent(content);
}

export function findValuesEnvironmentInContent(content: string): string | null {
  const line = content.split('\n').find(l => VALUES_ENV_PATTERN.test(l));
  return line ? line.replace(VALUES_ENV_PATTERN, '').trim() || null : null;
}

export function upsertSelectionInContent(content: string, environment: string, valuesEnvironment: string): string {
  validateEnvironmentName(valuesEnvironment);
  const lines = upsertEnvironmentInContent(content, environment).split('\n').filter(l => !VALUES_ENV_PATTERN.test(l));
  const envIdx = lines.findIndex(l => /^#\s*env-manager env:/.test(l));
  lines.splice(envIdx + 1, 0, `${VALUES_ENV_PREFIX}${valuesEnvironment}`);
  return lines.join('\n');
}

export async function resolveEnvironment(
  cwd: string,
  options: ResolveEnvironmentOptions = {}
): Promise<string> {
  return (await findEnvironment(cwd, options)) ?? DEFAULT_ENVIRONMENT;
}

export function upsertEnvironmentInContent(
  content: string,
  environment: string
): string {
  validateEnvironmentName(environment);

  const comment = `${ENV_COMMENT_PREFIX}${environment}`;
  const lines = content.split('\n');
  const existingIdx = lines.findIndex((line) =>
    /^#\s*env-manager env:/.test(line)
  );
  if (existingIdx !== -1) {
    lines[existingIdx] = comment;
    return lines.join('\n');
  }

  const headerIdx = lines.findIndex((line) => /^#\s*env-manager:/.test(line));
  if (headerIdx !== -1) {
    lines.splice(headerIdx + 1, 0, comment);
    return lines.join('\n');
  }

  return `${comment}\n${content}`;
}

export function removeEnvironmentFromContent(content: string): string {
  return content
    .split('\n')
    .filter((line) => !/^#\s*env-manager env:/.test(line))
    .join('\n');
}
