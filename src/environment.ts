import { EnvManagerError } from './types';

export const DEFAULT_ENVIRONMENT = 'local';

const ENV_COMMENT_PREFIX = '# env-manager env: ';
const ENV_NAME_PATTERN = /^[^\s|]+$/;

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

export function resolveEnvironmentFromContent(content: string): string {
  for (const line of content.split('\n')) {
    const environment = parseEnvironmentComment(line);
    if (environment) {
      return environment;
    }
  }
  return DEFAULT_ENVIRONMENT;
}

export async function resolveEnvironment(
  cwd: string,
  options: ResolveEnvironmentOptions = {}
): Promise<string> {
  const candidates = options.valuesPath
    ? [options.valuesPath, '.env.local']
    : ['.env.local'];
  const seen = new Set<string>();

  for (const candidate of candidates) {
    if (seen.has(candidate)) {
      continue;
    }
    seen.add(candidate);

    const path = candidate.startsWith('/') ? candidate : `${cwd}/${candidate}`;
    const localFile = Bun.file(path);
    if (!(await localFile.exists())) {
      continue;
    }
    return resolveEnvironmentFromContent(await localFile.text());
  }

  return DEFAULT_ENVIRONMENT;
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
