import { expect, test } from 'bun:test';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { withTempDir } from '../test-setup';
import { initCommand } from './init';

test('init adopts an existing .env without metadata by adding the project header, and never rewrites its variables', async () => {
  await withTempDir(async (dir) => {
    const ctx = { project: 'tool', cwd: dir };
    await writeFile(path.join(dir, 'package.json'), '{}\n');
    await writeFile(path.join(dir, '.env'), 'PORT=3000\n');
    await initCommand(ctx, { local: true });
    const adopted = '# env-manager: tool\n# env-manager local: true\n\nPORT=3000\n';
    expect(await readFile(path.join(dir, '.env'), 'utf8')).toBe(adopted);

    await initCommand(ctx, { local: true });
    expect(await readFile(path.join(dir, '.env'), 'utf8')).toBe(adopted);
  });
});
