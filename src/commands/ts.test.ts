import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { tsCommand, updateConfiguredTsOutput } from './ts';

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'env-manager-ts-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const ENV_CONTENT = `# env-manager: test-project | 2025-01-01T00:00:00Z\n\nFOO=bar # {optional string}\n`;

describe('ts command', () => {
  test('does not emit zod defaults from .env values', async () => {
    await withTempDir(async (dir) => {
      await writeFile(path.join(dir, '.env'), ENV_CONTENT);

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
      await writeFile(
        path.join(dir, '.env'),
        [
          '# env-manager: test-project | 2025-01-01T00:00:00Z',
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

  test('stores ts path in .env after generation', async () => {
    await withTempDir(async (dir) => {
      await writeFile(path.join(dir, '.env'), ENV_CONTENT);
      const outPath = path.join(dir, 'env.ts');

      await tsCommand({ project: 'test-project', cwd: dir }, outPath);

      const envAfter = await readFile(path.join(dir, '.env'), 'utf8');
      expect(envAfter).toContain(`# env-manager ts: ${outPath}`);
    });
  });

  test('ts path comment is inserted after the header line', async () => {
    await withTempDir(async (dir) => {
      await writeFile(path.join(dir, '.env'), ENV_CONTENT);
      const outPath = path.join(dir, 'env.ts');

      await tsCommand({ project: 'test-project', cwd: dir }, outPath);

      const envAfter = await readFile(path.join(dir, '.env'), 'utf8');
      const lines = envAfter.split('\n');
      expect(lines[0]).toStartWith('# env-manager:');
      expect(lines[1]).toBe(`# env-manager ts: ${outPath}`);
    });
  });

  test('uses stored ts path when no path argument given', async () => {
    await withTempDir(async (dir) => {
      const outPath = path.join(dir, 'custom/env.ts');
      await writeFile(
        path.join(dir, '.env'),
        `# env-manager: test-project | 2025-01-01T00:00:00Z\n# env-manager ts: ${outPath}\n\nFOO=bar # {string}\n`
      );
      const { mkdir } = await import('node:fs/promises');
      await mkdir(path.join(dir, 'custom'), { recursive: true });

      await tsCommand({ project: 'test-project', cwd: dir });

      const output = await readFile(outPath, 'utf8');
      expect(output).toContain('FOO: z.string(),');
    });
  });

  test('errors when given path conflicts with stored path', async () => {
    await withTempDir(async (dir) => {
      await writeFile(
        path.join(dir, '.env'),
        `# env-manager: test-project | 2025-01-01T00:00:00Z\n# env-manager ts: old.ts\n\nFOO=bar # {string}\n`
      );

      expect(
        tsCommand({ project: 'test-project', cwd: dir }, 'new.ts')
      ).rejects.toThrow('Pass --force to overwrite');
    });
  });

  test('--force overwrites stored ts path', async () => {
    await withTempDir(async (dir) => {
      await writeFile(
        path.join(dir, '.env'),
        `# env-manager: test-project | 2025-01-01T00:00:00Z\n# env-manager ts: old.ts\n\nFOO=bar # {string}\n`
      );
      const newPath = path.join(dir, 'new.ts');

      await tsCommand({ project: 'test-project', cwd: dir }, newPath, {
        force: true,
      });

      const output = await readFile(newPath, 'utf8');
      expect(output).toContain('FOO: z.string(),');
      const envAfter = await readFile(path.join(dir, '.env'), 'utf8');
      expect(envAfter).toContain(`# env-manager ts: ${newPath}`);
      expect(envAfter).not.toContain('old.ts');
    });
  });

  test('updates a configured ts output from env content', async () => {
    await withTempDir(async (dir) => {
      await mkdir(path.join(dir, 'generated'), { recursive: true });

      await updateConfiguredTsOutput(
        { project: 'test-project', cwd: dir },
        [
          '# env-manager: test-project | 2025-01-01T00:00:00Z',
          '# env-manager ts: generated/env.ts',
          '',
          'FOO=bar # {int}',
          '',
        ].join('\n')
      );

      const output = await readFile(
        path.join(dir, 'generated/env.ts'),
        'utf8'
      );
      expect(output).toContain('FOO: z.coerce.number().int(),');
    });
  });
});
