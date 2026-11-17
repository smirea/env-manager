import { expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { initCommand } from './init';

test('init adopts an existing .env without metadata by adding the project header, and never rewrites its variables', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'env-manager-init-'));
  try {
    const ctx = { project: 'tool', cwd: dir };
    await writeFile(path.join(dir, 'package.json'), '{}\n');
    await writeFile(path.join(dir, '.env'), 'PORT=3000\n');
    await initCommand(ctx, { local: true });
    const adopted = '# env-manager: tool\n# env-manager local: true\n\nPORT=3000\n';
    expect(await readFile(path.join(dir, '.env'), 'utf8')).toBe(adopted);

    await initCommand(ctx, { local: true });
    expect(await readFile(path.join(dir, '.env'), 'utf8')).toBe(adopted);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
