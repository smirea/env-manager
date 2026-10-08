import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseRootConfig } from './config';
import { parseHeader } from './parser';
import { EnvManagerError } from './types';

export function resolveProjectRoot(cwd: string): string {
  let directory = realpathSync(cwd);
  while (true) {
    const file = join(directory, '.env');
    if (existsSync(file)) {
      const content = readFileSync(file, 'utf8');
      const target = content.match(/^(?:#|\/\/)\s*env-manager target:\s*(\S+)\s*$/m)?.[1];
      const pointer = content.match(/^(?:#|\/\/)\s*env-manager root:\s*(.+?)\s*$/m)?.[1];
      if (target || pointer) {
        if (!target || !pointer) throw new EnvManagerError(`${file}:1: Generated child file needs target and root ownership metadata.`);
        const root = resolve(directory, pointer);
        const rootFile = join(root, '.env');
        if (root === directory || !existsSync(rootFile)) throw new EnvManagerError(`${file}:1: Owning root .env not found.`);
        const config = parseRootConfig(readFileSync(rootFile, 'utf8'), rootFile);
        const header = content.split('\n').map(line => parseHeader(line.replace(/^\/\//, '#'))).find(Boolean);
        if (config.header?.project !== header?.project || !config.targets.some(t => t.name === target)) {
          throw new EnvManagerError(`${file}:1: Root does not own target "${target}" for this project.`);
        }
        const declaration = config.targets.find(t => t.name === target)!;
        const expected = [declaration.path, declaration.generate].filter(Boolean).map(path => join(root, target, path!));
        if (!expected.some(path => existsSync(path) && realpathSync(path) === realpathSync(file))) throw new EnvManagerError(`${file}:1: Child is not a declared output of target "${target}".`);
        return realpathSync(root);
      }
      return directory;
    }
    const parent = dirname(directory);
    if (parent === directory) return realpathSync(cwd);
    directory = parent;
  }
}
