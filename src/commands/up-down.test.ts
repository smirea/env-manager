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
});
