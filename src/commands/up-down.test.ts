import { describe, expect, mock, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { SecretPayload } from '../types';

const secrets = new Map<string, SecretPayload>();
const puts: SecretPayload[] = [];
mock.module('../aws', () => ({
  secretName: (project: string) => `env-manager/${project}`,
  createAwsAdapter: () => ({
    getSecret: async (name: string) => structuredClone(secrets.get(name) ?? null),
    putSecret: async (name: string, payload: SecretPayload) => {
      puts.push(payload);
      secrets.set(name, structuredClone(payload));
    },
  }),
}));

const { upCommand } = await import('./up');
const { downCommand } = await import('./down');

describe('output versions', () => {
  test('bump only on mutation and stay out of .env', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'env-manager-version-'));
    try {
      const ctx = { project: 'demo', cwd: dir };
      await writeFile(path.join(dir, 'package.json'), '{}\n');
      await writeFile(path.join(dir, '.env'), '# env-manager: demo | 2025-01-01T00:00:00Z\n\nFOO= # {string}\n');
      await writeFile(path.join(dir, '.env.local'), 'FOO=one\n');

      const read = (name: string) => readFile(path.join(dir, name), 'utf8');
      const outputs = (index: number) => puts[index].environments?.local.outputs;

      await upCommand(ctx);
      expect(puts).toHaveLength(1);
      expect(puts[0].schema).toBe('# env-manager: demo\n\nFOO= # {string}\n');
      expect(outputs(0)?.['.env.local']?.version).toBe(1);
      expect(outputs(0)?.['.env.local']?.date).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(await read('.env')).toBe('# env-manager: demo\n\nFOO= # {string}\n');
      const hash = outputs(0)?.['.env.local']?.hash;
      expect(await read('.env.local')).toBe(`# env-manager: demo | v1\n# env-manager output: .env.local v1 ${hash}\nFOO=one\n`);

      await upCommand(ctx);
      expect(puts).toHaveLength(1);

      await writeFile(path.join(dir, '.env.local'), (await read('.env.local')).replace('FOO=one', 'FOO=two'));
      await upCommand(ctx);
      expect(puts).toHaveLength(2);
      expect(outputs(1)?.['.env.local']?.version).toBe(2);

      await writeFile(path.join(dir, '.env.local'), 'FOO=stale\n');
      await downCommand(ctx);
      const local = await read('.env.local');
      expect(local.split('\n')[0]).toBe('# env-manager: demo | v2');
      expect(local).toContain("FOO='two' # {string}");
      expect(local).not.toMatch(/\d{4}-\d{2}-\d{2}/);
      expect(await read('.env')).toBe('# env-manager: demo\n\nFOO= # {string}\n');

      await downCommand(ctx);
      expect(await read('.env.local')).toBe(local);
      expect(puts).toHaveLength(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('down requires an explicit environment when several exist and none is recorded', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'env-manager-env-'));
    try {
      const ctx = { project: 'multi', cwd: dir };
      const schema = '# env-manager: multi\n\nFOO= # {string}\n';
      secrets.set('env-manager/multi', {
        schema,
        environments: {
          local: { values: 'FOO=local\n', syncDate: '2026-01-01T00:00:00Z' },
          prod: { values: 'FOO=prod\n', syncDate: '2026-01-01T00:00:00Z' },
        },
      });
      await writeFile(path.join(dir, 'package.json'), '{}\n');
      await writeFile(path.join(dir, '.env'), schema);
      const read = (name: string) => readFile(path.join(dir, name), 'utf8');

      await expect(downCommand(ctx)).rejects.toThrow('No environment selected for "multi". Pass --env <name> or run "env-manager env set <name>". Available: local, prod');
      expect(await Bun.file(path.join(dir, '.env.local')).exists()).toBe(false);
      await expect(downCommand(ctx, { environment: 'staging' })).rejects.toThrow('Environment "staging" not found for project "multi". Available: local, prod');

      await downCommand(ctx, { environment: 'prod' });
      expect(await read('.env.local')).toContain("# env-manager env: prod\n");
      expect(await read('.env.local')).toContain("FOO='prod'");

      await downCommand(ctx);
      expect(await read('.env.local')).toContain("FOO='prod'");

      await downCommand(ctx, { environment: 'local' });
      expect(await read('.env.local')).toContain("# env-manager env: local\n");
      expect(await read('.env.local')).toContain("FOO='local'");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('down records the chosen environment for swift values', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'env-manager-swift-env-'));
    try {
      const ctx = { project: 'ios', cwd: dir };
      const schema = '# env-manager: ios\n# env-manager format: swift\n\nFOO= # {string}\n';
      secrets.set('env-manager/ios', {
        schema,
        environments: {
          local: { values: 'FOO=local\n', syncDate: '2026-01-01T00:00:00Z' },
          prod: { values: 'FOO=prod\n', syncDate: '2026-01-01T00:00:00Z' },
        },
      });
      await writeFile(path.join(dir, 'package.json'), '{}\n');
      await writeFile(path.join(dir, '.env'), schema);
      const xcconfig = path.join(dir, 'Config/LocalSecrets.xcconfig');

      await downCommand(ctx, { environment: 'prod' });
      expect(await readFile(path.join(dir, '.env.local'), 'utf8')).toBe('# env-manager env: prod\n');
      expect(await readFile(xcconfig, 'utf8')).toContain('FOO = prod');

      await downCommand(ctx);
      expect(await readFile(xcconfig, 'utf8')).toContain('FOO = prod');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('overrides survive down and never reach AWS', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'env-manager-override-'));
    try {
      const ctx = { project: 'mono', cwd: dir };
      await writeFile(path.join(dir, 'package.json'), '{}\n');
      await writeFile(path.join(dir, '.env'), '# env-manager: mono\n# env-manager target: web format=ts path=.env.local\n# env-manager targets: web\nPORT=3000 # {int}\n');
      await writeFile(path.join(dir, '.env.local'), '# env-manager env: local\nPORT=3000\n');
      await writeFile(path.join(dir, '.env.override'), 'PORT=4100\n');

      await upCommand(ctx);
      expect(secrets.get('env-manager/mono')?.environments?.local.values).not.toContain('4100');
      await writeFile(path.join(dir, '.env.local'), '# env-manager env: local\nPORT=9999\n');
      await downCommand(ctx);
      expect(await readFile(path.join(dir, '.env.local'), 'utf8')).toContain('PORT=3000');
      expect(await readFile(path.join(dir, 'web/.env.local'), 'utf8')).toContain('PORT=4100 ');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
