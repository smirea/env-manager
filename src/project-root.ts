import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { parseRootConfig, targetPaths } from './config';
import { EnvManagerError } from './errors';
import { gitRoot } from './files';
import { hasMetadata, readMetadata } from './metadata';

export type ProjectLocation =
  | { kind: 'managed'; root: string; start: string; ignored: string[] }
  | { kind: 'none'; start: string; repoRoot: string | null; ignored: string[] };

// Outside a git repository only the starting directory is searched, so a stray
// ~/.env or other unrelated parent file can never become the project.
export function locateProject(cwd: string): ProjectLocation {
  const start = realpathSync(cwd);
  const repoRoot = gitRoot(start);
  const ignored: string[] = [];
  let directory = start;
  while (true) {
    const file = join(directory, '.env');
    if (existsSync(file)) {
      const content = readFileSync(file, 'utf8');
      if (hasMetadata(content)) {
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
  const child = readMetadata(content);
  if (!child.target && !child.root) return directory;
  if (!child.target || !child.root) throw new EnvManagerError(`${file}:1: Generated child file needs target and root ownership metadata.`);
  const root = resolve(directory, child.root);
  const rootFile = join(root, '.env');
  if (root === directory || !existsSync(rootFile)) throw new EnvManagerError(`${file}:1: Owning root .env not found.`);
  const config = parseRootConfig(readFileSync(rootFile, 'utf8'), rootFile);
  const declaration = config.targets.find(t => t.name === child.target);
  if (config.project !== child.project || !declaration) {
    throw new EnvManagerError(`${file}:1: Root does not own target "${child.target}" for this project.`);
  }
  const { values, reader } = targetPaths(root, declaration);
  if (![values, reader].some(path => path && existsSync(path) && realpathSync(path) === realpathSync(file))) throw new EnvManagerError(`${file}:1: Child is not a declared output of target "${child.target}".`);
  return realpathSync(root);
}

export function resolveProjectName(cwd: string, explicitProject?: string): string {
  if (explicitProject !== undefined) return explicitProject;
  const envPath = join(cwd, '.env');
  return (existsSync(envPath) ? readMetadata(readFileSync(envPath, 'utf8')).project : null) ?? basename(cwd);
}
