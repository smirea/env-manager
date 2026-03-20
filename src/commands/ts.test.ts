import { describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { tsCommand } from './ts';

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'env-manager-ts-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe('ts command', () => {
  test('does not emit zod defaults from .env values', async () => {
    await withTempDir(async (dir) => {
      const envPath = path.join(dir, '.env');
      await writeFile(
        envPath,
        `#env-manager: test-project | 2025-01-01T00:00:00Z\n\nFOO=bar # {optional string}\n`
      );

      await tsCommand(
        { project: 'test-project', cwd: dir },
        path.join(dir, 'env.ts')
      );

      const output = await readFile(path.join(dir, 'env.ts'), 'utf8');
      expect(output).toContain('FOO: z.string().optional(),');
      expect(output).not.toContain('.default(');
    });
  });

  test('generates a small env reader with current zod helpers', async () => {
    await withTempDir(async (dir) => {
      const envPath = path.join(dir, '.env');
      await writeFile(
        envPath,
        [
          '#env-manager: test-project | 2025-01-01T00:00:00Z',
          '',
          'CALLBACK= # {url}',
          'ADMIN= # {optional email}',
          'DEBUG= # {optional bool}',
          '',
        ].join('\n')
      );

      await tsCommand(
        { project: 'test-project', cwd: dir },
        path.join(dir, 'env.ts')
      );

      const output = await readFile(path.join(dir, 'env.ts'), 'utf8');
      expect(output).toContain('const env = z.object({');
      expect(output).toContain('CALLBACK: z.url(),');
      expect(output).toContain('ADMIN: z.email().optional(),');
      expect(output).toContain('DEBUG: z.stringbool().optional(),');
      expect(output).toContain('}).parse(process.env);');
      expect(output).toContain('export default env;');
      expect(output).not.toContain('envSchema');
      expect(output).not.toContain('type Env');
      expect(output).not.toContain('cachedEnv');
      expect(output).not.toContain('readEnv');
      expect(output).not.toContain('getEnvVar');
      expect(output).not.toContain('setEnvVar');
    });
  });
});
