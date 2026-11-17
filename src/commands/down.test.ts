import { describe, expect, test } from 'bun:test';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { secrets, withTempDir } from '../test-setup';
import { downCommand } from './down';

const stored = (values: Record<string, string>) => Object.fromEntries(
  Object.entries(values).map(([name, value]) => [name, { values: value, syncDate: '2026-01-01T00:00:00Z' }]),
);

describe('down', () => {
  test('down needs --env when several environments exist and none is recorded, and then records the one it loaded', async () => {
    await withTempDir(async (dir) => {
      const ctx = { project: 'multi', cwd: dir };
      const read = (name: string) => readFile(path.join(dir, name), 'utf8');
      const schema = '# env-manager: multi\n\nFOO= # {string}\n';
      secrets.set('env-manager/multi', { schema, environments: stored({ local: 'FOO=local\n', prod: 'FOO=prod\n' }) });
      await writeFile(path.join(dir, 'package.json'), '{}\n');
      await writeFile(path.join(dir, '.env'), schema);

      await expect(downCommand(ctx)).rejects.toThrow();
      expect(await Bun.file(path.join(dir, '.env.local')).exists()).toBe(false);

      await downCommand(ctx, { environment: 'prod' });
      expect(await read('.env.local')).toContain('# env-manager env: prod\n');
      expect(await read('.env.local')).toContain("FOO='prod'");

      await downCommand(ctx);
      expect(await read('.env.local')).toContain("FOO='prod'");

      await downCommand(ctx, { environment: 'local' });
      expect(await read('.env.local')).toContain('# env-manager env: local\n');
      expect(await read('.env.local')).toContain("FOO='local'");
    });
  });

  test('down records the chosen environment in .env.local for swift values', async () => {
    await withTempDir(async (dir) => {
      const ctx = { project: 'ios', cwd: dir };
      const schema = '# env-manager: ios\n# env-manager format: swift\n\nFOO= # {string}\n';
      secrets.set('env-manager/ios', { schema, environments: stored({ local: 'FOO=local\n', prod: 'FOO=prod\n' }) });
      await writeFile(path.join(dir, 'package.json'), '{}\n');
      await writeFile(path.join(dir, '.env'), schema);
      const xcconfig = path.join(dir, 'Config/LocalSecrets.xcconfig');

      await downCommand(ctx, { environment: 'prod' });
      expect(await readFile(path.join(dir, '.env.local'), 'utf8')).toBe('# env-manager env: prod\n# env-manager values env: prod\n');
      expect(await readFile(xcconfig, 'utf8')).toContain('FOO = prod');

      await downCommand(ctx);
      expect(await readFile(xcconfig, 'utf8')).toContain('FOO = prod');
    });
  });

  test('down never replaces a .env that belongs to another project', async () => {
    await withTempDir(async (dir) => {
      secrets.set('env-manager/other', { schema: '# env-manager: other\n\nFOO= # {string}\n', environments: stored({ local: 'FOO=x\n' }) });
      await writeFile(path.join(dir, 'package.json'), '{}\n');
      await writeFile(path.join(dir, '.env'), '# env-manager: demo\n\nBAR= # {string}\n');
      await expect(downCommand({ project: 'other', cwd: dir })).rejects.toThrow();
      expect(await readFile(path.join(dir, '.env'), 'utf8')).toBe('# env-manager: demo\n\nBAR= # {string}\n');
    });
  });
});
