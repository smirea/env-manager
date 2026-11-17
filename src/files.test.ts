import { describe, expect, test } from 'bun:test';
import { appendFile, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withGitUpdates, writeManagedFile } from './files';

function git(dir: string, ...args: string[]): string {
  const result = Bun.spawnSync(['git', '-C', dir, ...args], { env: process.env });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  return result.stdout.toString().trimEnd();
}

async function withRepo(fn: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'env-manager-git-'));
  try {
    git(dir, 'init');
    await appendFile(join(dir, '.git/config'), '[user]\n\temail = test@example.com\n\tname = Test\n[commit]\n\tgpgsign = false\n[core]\n\thooksPath = /dev/null\n');
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
  test('an update commits only the files it changed that were clean, re-adds the ones that were staged without committing them, and leaves every other file alone', async () => {
    await withRepo(async (dir) => {
      await mkdir(join(dir, 'sub'));
      await writeFile(join(dir, 'staged'), 'staged edit\n');
      await writeFile(join(dir, 'unrelated'), 'unrelated edit\n');
      git(dir, 'add', 'staged', 'unrelated');
      await writeFile(join(dir, 'staged'), 'staged plus unstaged\n');
      await writeFile(join(dir, 'dirty'), 'user edit\n');
      await withGitUpdates(join(dir, 'sub'), async () => {
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

  test('staged additions and renames are re-added, not committed', async () => {
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

  test('a write that leaves a file as it was neither commits nor disturbs its partial staging', async () => {
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

  test('a failed command commits and stages nothing', async () => {
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
});
