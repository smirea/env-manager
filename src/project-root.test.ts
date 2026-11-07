import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { resolveProjectName } from './project-root';

describe('project name resolution', () => {
  test('prefers --project, then the .env header, then the directory name', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'env-manager-name-'));
    try {
      expect(resolveProjectName(dir)).toBe(path.basename(dir));
      await writeFile(path.join(dir, '.env'), '# note\n# env-manager: from-header | v3\n');
      expect(resolveProjectName(dir)).toBe('from-header');
      expect(resolveProjectName(dir, 'explicit')).toBe('explicit');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
