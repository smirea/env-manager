import { describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { withGitUpdates, writeManagedFile } from './git-updates';

function git(dir: string, ...args: string[]): string {
  const result = Bun.spawnSync(['git', '-C', dir, ...args]);
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  return result.stdout.toString().trimEnd();
}

async function withRepo(fn: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'env-manager-git-'));
  try {
    git(dir, 'init');
    git(dir, 'config', 'user.email', 'test@example.com');
    git(dir, 'config', 'user.name', 'Test');
    git(dir, 'config', 'commit.gpgsign', 'false');
    git(dir, 'config', 'core.hooksPath', '/dev/null');
    for (const name of ['clean', 'staged', 'dirty', 'unrelated', 'space file']) {
      await writeFile(join(dir, name), 'original\n');
    }
    await writeFile(join(dir, '.gitignore'), 'ignored\n');
    git(dir, 'add', '.');
    git(dir, 'commit', '-m', 'initial');
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe('Git updates', () => {
  test('commits only touched clean files and re-adds staged files without committing them', async () => {
    await withRepo(async (dir) => {
      await writeFile(join(dir, 'staged'), 'staged edit\n');
      await writeFile(join(dir, 'unrelated'), 'unrelated edit\n');
      git(dir, 'add', 'staged', 'unrelated');
      await writeFile(join(dir, 'staged'), 'staged plus unstaged\n');
      await writeFile(join(dir, 'dirty'), 'user edit\n');
      await withGitUpdates(dir, async () => {
        for (const name of ['clean', 'space file', 'staged', 'dirty', 'untracked', 'ignored']) {
          await writeManagedFile(join(dir, name), `${name} update\n`);
        }
        await writeFile(join(dir, 'unrelated'), 'concurrent edit\n');
      });
      expect(git(dir, 'log', '-1', '--format=%s')).toBe('chore: env manager update');
      expect(git(dir, 'diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD')).toBe('clean\nspace file');
      expect(git(dir, 'diff', '--cached', '--name-only')).toBe('staged\nunrelated');
      expect(git(dir, 'show', ':staged')).toBe('staged update');
      expect(git(dir, 'show', ':unrelated')).toBe('unrelated edit');
      expect(git(dir, 'diff', '--name-only')).toBe('dirty\nunrelated');
      expect(git(dir, 'ls-files', '--others', '--exclude-standard')).toBe('untracked');
    });
  });

  test('staged additions and renames are re-added without a commit', async () => {
    await withRepo(async (dir) => {
      git(dir, 'mv', 'staged', 'renamed');
      await writeFile(join(dir, 'added'), 'new\n');
      git(dir, 'add', 'added');
      const head = git(dir, 'rev-parse', 'HEAD');
      await withGitUpdates(dir, async () => {
        await writeManagedFile(join(dir, 'renamed'), 'renamed update\n');
        await writeManagedFile(join(dir, 'added'), 'added update\n');
      });
      expect(git(dir, 'rev-parse', 'HEAD')).toBe(head);
      expect(git(dir, 'show', ':renamed')).toBe('renamed update');
      expect(git(dir, 'show', ':added')).toBe('added update');
      expect(git(dir, 'diff', '--name-only')).toBe('');
    });
  });

  test('unchanged writes preserve partial staging and do not commit', async () => {
    await withRepo(async (dir) => {
      await writeFile(join(dir, 'staged'), 'staged edit\n');
      git(dir, 'add', 'staged');
      await writeFile(join(dir, 'staged'), 'unstaged edit\n');
      const head = git(dir, 'rev-parse', 'HEAD');
      await withGitUpdates(dir, async () => {
        await writeManagedFile(join(dir, 'staged'), 'unstaged edit\n');
        await writeManagedFile(join(dir, 'clean'), 'temporary\n');
        await writeManagedFile(join(dir, 'clean'), 'original\n');
      });
      expect(git(dir, 'rev-parse', 'HEAD')).toBe(head);
      expect(git(dir, 'show', ':staged')).toBe('staged edit');
    });
  });

  test('failed operations leave their edits uncommitted', async () => {
    await withRepo(async (dir) => {
      const head = git(dir, 'rev-parse', 'HEAD');
      await expect(withGitUpdates(dir, async () => {
        await writeManagedFile(join(dir, 'clean'), 'update\n');
        throw new Error('operation failed');
      })).rejects.toThrow('operation failed');
      expect(git(dir, 'rev-parse', 'HEAD')).toBe(head);
      expect(git(dir, 'diff', '--cached', '--name-only')).toBe('');
      expect(git(dir, 'diff', '--name-only')).toBe('clean');
    });
  });

  test('CLI captures command-start state when run from a repository subdirectory', async () => {
    const cli = resolve(import.meta.dir, 'cli.ts');
    await withRepo(async (dir) => {
      const subdir = join(dir, 'project');
      await mkdir(subdir);
      await writeFile(join(subdir, '.env'), '# env-manager values.format: ts\n');
      git(dir, 'add', 'project/.env');
      git(dir, 'commit', '-m', 'schema');
      const result = Bun.spawnSync([process.execPath, cli, 'set', 'values.format', 'swift'], { cwd: subdir });
      expect(result.exitCode).toBe(0);
      expect(git(dir, 'log', '-1', '--format=%s')).toBe('chore: env manager update');
      expect(git(dir, 'show', 'HEAD:project/.env')).toContain('values.format: swift');
      expect(git(dir, 'status', '--porcelain')).toBe('');
    });
  });

  test('writes work outside a Git repository', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'env-manager-no-git-'));
    try {
      await withGitUpdates(dir, () => writeManagedFile(join(dir, 'file'), 'content'));
      expect(await Bun.file(join(dir, 'file')).text()).toBe('content');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
