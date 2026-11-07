import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseRootConfig } from './config';
import { parseHeader } from './parser';
import { EnvManagerError } from './types';

export type ProjectLocation =
  | { kind: 'managed'; root: string; start: string; ignored: string[] }
  | { kind: 'none'; start: string; repoRoot: string | null; ignored: string[] };

const METADATA_LINE = /^(?:#|\/\/)\s*env-manager\b/m;

export function isManagedEnvFile(content: string): boolean {
  return METADATA_LINE.test(content);
}

export function gitRepoRoot(cwd: string): string | null {
  const result = Bun.spawnSync(['git', '-C', cwd, 'rev-parse', '--show-toplevel'], { env: process.env });
  if (result.exitCode !== 0) return null;
  return realpathSync(result.stdout.toString().trimEnd());
}

// Outside a git repository only the starting directory is searched, so a stray
// ~/.env or other unrelated parent file can never become the project.
export function locateProject(cwd: string): ProjectLocation {
  const start = realpathSync(cwd);
  const repoRoot = gitRepoRoot(start);
  const ignored: string[] = [];
  let directory = start;
  while (true) {
    const file = join(directory, '.env');
    if (existsSync(file)) {
      const content = readFileSync(file, 'utf8');
      if (isManagedEnvFile(content)) {
        return { kind: 'managed', root: resolveOwner(file, directory, content), start, ignored };
      }
      ignored.push(file);
    }
    const parent = dirname(directory);
    if (!repoRoot || directory === repoRoot || parent === directory) break;
    directory = parent;
  }
  return { kind: 'none', start, repoRoot, ignored };
}

function resolveOwner(file: string, directory: string, content: string): string {
  const target = content.match(/^(?:#|\/\/)\s*env-manager target:\s*(\S+)\s*$/m)?.[1];
  const pointer = content.match(/^(?:#|\/\/)\s*env-manager root:\s*(.+?)\s*$/m)?.[1];
  if (!target && !pointer) return directory;
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
