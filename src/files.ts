import { AsyncLocalStorage } from 'node:async_hooks';
import { realpathSync } from 'node:fs';
import { realpath } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { EnvManagerError } from './errors';

type GitUpdates = {
  root: string;
  states: Map<string, 'clean' | 'staged'>;
  originals: Map<string, Buffer | null>;
};

const updates = new AsyncLocalStorage<GitUpdates>();

function git(cwd: string, args: string[]): string {
  const result = Bun.spawnSync(['git', '--literal-pathspecs', '-C', cwd, ...args], { env: process.env });
  if (result.exitCode !== 0) {
    throw new EnvManagerError(`Git update failed: ${result.stderr.toString().trim()}`);
  }
  return result.stdout.toString();
}

export function gitRoot(cwd: string): string | null {
  const result = Bun.spawnSync(['git', '-C', cwd, 'rev-parse', '--show-toplevel'], { env: process.env });
  if (result.exitCode !== 0) return null;
  return realpathSync(result.stdout.toString().trimEnd());
}

function snapshot(cwd: string): GitUpdates | undefined {
  const root = gitRoot(cwd);
  if (!root) return;
  const states: GitUpdates['states'] = new Map();
  for (const entry of git(root, ['ls-files', '--stage', '-z']).split('\0')) {
    const tab = entry.indexOf('\t');
    if (tab === -1) continue;
    const [mode, , stage] = entry.slice(0, tab).split(' ');
    if (stage === '0' && (mode === '100644' || mode === '100755')) {
      states.set(entry.slice(tab + 1), 'clean');
    }
  }
  const entries = git(root, ['status', '--porcelain=v1', '--untracked-files=no', '-z']).split('\0');
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry) continue;
    const status = entry.slice(0, 2);
    const path = entry.slice(3);
    if (status.includes('U') || status === 'AA' || status === 'DD') {
      states.delete(path);
    } else if (status[0] !== ' ' && states.has(path)) {
      states.set(path, 'staged');
    } else {
      states.delete(path);
    }
    if (status.includes('R') || status.includes('C')) i++;
  }
  return { root, states, originals: new Map() };
}

async function readBytes(path: string): Promise<Buffer | null> {
  const file = Bun.file(path);
  return await file.exists() ? Buffer.from(await file.arrayBuffer()) : null;
}

export async function readText(path: string): Promise<string | null> {
  const file = Bun.file(path);
  return await file.exists() ? file.text() : null;
}

export async function writeManagedFile(path: string, content: string): Promise<boolean> {
  const session = updates.getStore();
  const absolutePath = resolve(await realpath(dirname(path)).catch(() => dirname(path)), basename(path));
  const existing = await readBytes(absolutePath);
  if (existing?.equals(Buffer.from(content))) return false;
  if (session && !session.originals.has(absolutePath)) {
    session.originals.set(absolutePath, existing);
  }
  await Bun.write(path, content);
  return true;
}

export async function withGitUpdates<T>(cwd: string, operation: () => Promise<T>): Promise<T> {
  const session = snapshot(cwd);
  if (!session) return operation();
  return updates.run(session, async () => {
    const result = await operation();
    const clean: string[] = [];
    const staged: string[] = [];
    for (const [path, state] of session.states) {
      const absolutePath = resolve(session.root, path);
      if (!session.originals.has(absolutePath)) continue;
      const original = session.originals.get(absolutePath);
      const current = await readBytes(absolutePath);
      if (original === null ? current === null : current && original?.equals(current)) continue;
      (state === 'clean' ? clean : staged).push(path);
    }
    if (staged.length) {
      git(session.root, ['add', '--', ...staged]);
    }
    if (clean.length) {
      git(session.root, ['commit', '--only', '-m', 'chore: env manager update', '--', ...clean]);
      console.log(`Committed env manager update: ${clean.join(', ')}`);
    }
    return result;
  });
}
