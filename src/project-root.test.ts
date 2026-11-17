import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { locateProject, resolveProjectName } from './project-root';

async function withTempDir(fn: (dir: string) => Promise<void>) {
  const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), 'env-manager-root-')));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function gitInit(dir: string) {
  const result = Bun.spawnSync(['git', 'init', dir], { env: process.env });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
}

const MANAGED = '# env-manager: demo\nPORT=3000 # {int}\n';

describe('project lookup', () => {
  test('lookup walks up to the repository root, skips a .env without env-manager metadata, and never looks above the repository', async () => {
    await withTempDir(async (dir) => {
      const repo = path.join(dir, 'repo');
      await mkdir(path.join(repo, 'web/src'), { recursive: true });
      gitInit(repo);
      await writeFile(path.join(dir, '.env'), MANAGED);
      expect(locateProject(path.join(repo, 'web/src'))).toMatchObject({ kind: 'none', repoRoot: repo });

      await writeFile(path.join(repo, '.env'), MANAGED);
      await writeFile(path.join(repo, 'web/.env'), 'NEXT_PUBLIC_X=1\n');
      expect(locateProject(path.join(repo, 'web/src'))).toEqual({
        kind: 'managed',
        root: repo,
        start: path.join(repo, 'web/src'),
        ignored: [path.join(repo, 'web/.env')],
      });
    });
  });

  test('outside a git repository only the current directory counts', async () => {
    await withTempDir(async (dir) => {
      await mkdir(path.join(dir, 'sub'));
      await writeFile(path.join(dir, '.env'), MANAGED);
      expect(locateProject(path.join(dir, 'sub'))).toMatchObject({ kind: 'none', repoRoot: null });
      expect(locateProject(dir)).toMatchObject({ kind: 'managed', root: dir });
    });
  });

  test('a generated child resolves to the root that declares it, and a child the root does not own fails instead of becoming a project', async () => {
    await withTempDir(async (dir) => {
      gitInit(dir);
      await mkdir(path.join(dir, 'client'));
      await writeFile(path.join(dir, '.env'), '# env-manager: mono\n# env-manager target: client format=ts path=.env\n# env-manager targets: client\nPORT=3000 # {int}\n');
      const child = '# env-manager: mono | v1\n# env-manager target: client\n# env-manager root: ..\nPORT=3000\n';
      await writeFile(path.join(dir, 'client/.env'), child);
      expect(locateProject(path.join(dir, 'client'))).toMatchObject({ kind: 'managed', root: dir });

      await writeFile(path.join(dir, 'client/.env'), child.replace('target: client', 'target: server'));
      expect(() => locateProject(path.join(dir, 'client'))).toThrow();
    });
  });
});

describe('project name resolution', () => {
  test('the project name is --project, then the .env header, then the directory name', async () => {
    await withTempDir(async (dir) => {
      expect(resolveProjectName(dir)).toBe(path.basename(dir));
      await writeFile(path.join(dir, '.env'), '# note\n# env-manager: from-header | v3\n');
      expect(resolveProjectName(dir)).toBe('from-header');
      expect(resolveProjectName(dir, 'explicit')).toBe('explicit');
    });
  });
});
