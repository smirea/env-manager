import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnvValues } from './parser';
import { EnvManagerError } from './types';

export function resolveOwnPackageRoot(moduleUrl: string): string {
  const modulePath = realpathSync(fileURLToPath(moduleUrl));
  let current = dirname(modulePath);
  while (!existsSync(join(current, 'package.json'))) {
    const parent = dirname(current);
    if (parent === current) {
      throw new EnvManagerError(`Could not find package root for env-manager from ${modulePath}`);
    }
    current = parent;
  }
  return current;
}

// env-manager's own .env is a schema with empty placeholders; loading those would
// clobber credentials the shell already provides, so only non-empty values apply.
export function loadOwnEnv(packageRoot: string): void {
  for (const file of ['.env', '.env.local']) {
    const path = join(packageRoot, file);
    if (!existsSync(path)) continue;
    for (const [key, value] of Object.entries(parseEnvValues(readFileSync(path, 'utf8')))) {
      if (value !== '') process.env[key] = value;
    }
  }
}
