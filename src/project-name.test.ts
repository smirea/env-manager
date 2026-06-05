import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { resolveProjectName } from './project-name';

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'env-manager-project-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe('project name resolution', () => {
  test('uses explicit project first', async () => {
    await withTempDir(async (dir) => {
      await writeFile(
        path.join(dir, '.env'),
        '# env-manager: from-env | 2026-01-01T00:00:00Z\n'
      );

      expect(resolveProjectName(dir, 'explicit')).toBe('explicit');
    });
  });

  test('uses .env header before directory name', async () => {
    await withTempDir(async (dir) => {
      await writeFile(
        path.join(dir, '.env'),
        '# env-manager: from-env | 2026-01-01T00:00:00Z\n'
      );

      expect(resolveProjectName(dir)).toBe('from-env');
    });
  });

  test('falls back to directory name', async () => {
    await withTempDir(async (dir) => {
      expect(resolveProjectName(dir)).toBe(path.basename(dir));
    });
  });
});
