import { existsSync, readFileSync, realpathSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { parseEnvValues } from './parser';
import { EnvManagerError } from './types';

export function resolveOwnEnvPaths(moduleUrl: string): string[] {
  const modulePath = realpathSync(fileURLToPath(moduleUrl));
  let current = dirname(modulePath);

  while (true) {
    if (existsSync(join(current, 'package.json'))) {
      return [current];
    }

    const parent = dirname(current);
    if (parent === current) {
      throw new EnvManagerError(
        `Could not find package root for env-manager from ${modulePath}`
      );
    }
    current = parent;
  }
}

export function loadEnvFromPaths(paths: string[]): void {
  loadEnvFromPathsWithMode(paths, false);
}

export function loadOwnEnvFromPaths(paths: string[]): void {
  loadEnvFromPathsWithMode(paths, true);
}

function loadEnvFromPathsWithMode(
  paths: string[],
  overrideExisting: boolean
): void {
  const envFiles = overrideExisting ? ['.env', '.env.local'] : ['.env.local', '.env'];
  const seen = new Set<string>();

  for (const basePath of paths) {
    if (!basePath || seen.has(basePath)) continue;
    seen.add(basePath);

    for (const file of envFiles) {
      const path = join(basePath, file);
      if (!existsSync(path)) continue;
      const content = readFileSync(path, 'utf8');
      const values = parseEnvValues(content);
      for (const [key, value] of Object.entries(values)) {
        if (overrideExisting || process.env[key] === undefined) {
          process.env[key] = value;
        }
      }
    }
  }
}
