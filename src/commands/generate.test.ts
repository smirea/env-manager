import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { generateCommand, syncOutputs } from './generate';

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'env-manager-ts-'));
  try {
    await writeFile(path.join(dir, 'package.json'), '{}\n');
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const ENV_CONTENT = `# env-manager: test-project | 2025-01-01T00:00:00Z\n\nFOO=bar # {optional string}\n`;

describe('generate command', () => {
  test('does not emit zod defaults from .env values', async () => {
    await withTempDir(async (dir) => {
      await writeFile(path.join(dir, '.env'), ENV_CONTENT);

      await generateCommand(
        { project: 'test-project', cwd: dir },
        'env.ts'
      );

      const output = await readFile(path.join(dir, 'env.ts'), 'utf8');
      expect(output).toContain('FOO: optional(z.string()),');
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

      await generateCommand(
        { project: 'test-project', cwd: dir },
        'env.ts'
      );

      const output = await readFile(path.join(dir, 'env.ts'), 'utf8');
      expect(output).toContain('const env = z.object({');
      expect(output).toContain('CALLBACK: z.url(),');
      expect(output).toContain('ADMIN: optional(z.email()),');
      expect(output).toContain('DEBUG: optional(z.stringbool()),');
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

  test('generated reader treats empty optional values as unset', async () => {
    await withTempDir(async (dir) => {
      await writeFile(path.join(dir, '.env'), '# env-manager: test-project\n\nCALLBACK= # {optional url}\nDEBUG= # {optional bool}\nNAME= # {string}\n');
      await generateCommand({ project: 'test-project', cwd: dir }, 'env.ts');
      await symlink(path.resolve(import.meta.dir, '../../node_modules'), path.join(dir, 'node_modules'));
      const result = Bun.spawnSync([process.execPath, '-e', "console.log(JSON.stringify((await import('./env.ts')).default))"], {
        cwd: dir,
        env: { PATH: process.env.PATH, CALLBACK: '', DEBUG: '', NAME: '' },
      });
      expect(result.stderr.toString()).toBe('');
      expect(JSON.parse(result.stdout.toString())).toEqual({ NAME: '' });
    });
  });

  test('stores ts path in .env after generation', async () => {
    await withTempDir(async (dir) => {
      await writeFile(path.join(dir, '.env'), ENV_CONTENT);
      const outPath = 'env.ts';

      await generateCommand({ project: 'test-project', cwd: dir }, outPath);

      const envAfter = await readFile(path.join(dir, '.env'), 'utf8');
      expect(envAfter).toContain(`# env-manager ts: ${outPath}`);
    });
  });

  test('ts path comment is inserted after the header line', async () => {
    await withTempDir(async (dir) => {
      await writeFile(path.join(dir, '.env'), ENV_CONTENT);
      const outPath = 'env.ts';

      await generateCommand({ project: 'test-project', cwd: dir }, outPath);

      const envAfter = await readFile(path.join(dir, '.env'), 'utf8');
      const lines = envAfter.split('\n');
      expect(lines[0]).toStartWith('# env-manager:');
      expect(lines[1]).toBe(`# env-manager ts: ${outPath}`);
    });
  });

  test('uses stored ts path when no path argument given', async () => {
    await withTempDir(async (dir) => {
      const outPath = 'custom/env.ts';
      await writeFile(
        path.join(dir, '.env'),
        `# env-manager: test-project | 2025-01-01T00:00:00Z\n# env-manager ts: ${outPath}\n\nFOO=bar # {string}\n`
      );
      const { mkdir } = await import('node:fs/promises');
      await mkdir(path.join(dir, 'custom'), { recursive: true });

      await generateCommand({ project: 'test-project', cwd: dir });

      const output = await readFile(path.join(dir, outPath), 'utf8');
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
        generateCommand({ project: 'test-project', cwd: dir }, 'new.ts')
      ).rejects.toThrow('Pass --force to overwrite');
    });
  });

  test('--force overwrites stored ts path', async () => {
    await withTempDir(async (dir) => {
      await writeFile(
        path.join(dir, '.env'),
        `# env-manager: test-project | 2025-01-01T00:00:00Z\n# env-manager ts: old.ts\n\nFOO=bar # {string}\n`
      );
      const newPath = 'new.ts';

      await generateCommand({ project: 'test-project', cwd: dir }, newPath, {
        force: true,
      });

      const output = await readFile(path.join(dir, newPath), 'utf8');
      expect(output).toContain('FOO: z.string(),');
      const envAfter = await readFile(path.join(dir, '.env'), 'utf8');
      expect(envAfter).toContain(`# env-manager ts: ${newPath}`);
      expect(envAfter).not.toContain('old.ts');
    });
  });

  test('updates a configured ts output from env content', async () => {
    await withTempDir(async (dir) => {
      await mkdir(path.join(dir, 'generated'), { recursive: true });

      await syncOutputs(
        { project: 'test-project', cwd: dir },
        [
          '# env-manager: test-project | 2025-01-01T00:00:00Z',
          '# env-manager ts: generated/env.ts',
          '',
          'FOO=3000 # {int}',
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

  test('rejects a reader path outside ts values mode', async () => {
    await withTempDir(async (dir) => {
      await writeFile(
        path.join(dir, '.env'),
        [
          '# env-manager: test-project | 2025-01-01T00:00:00Z',
          '# env-manager values.format: swift',
          '# env-manager values.path: Config/LocalSecrets.xcconfig',
          '',
          'FOO=bar # {string}',
          '',
        ].join('\n')
      );

      await expect(
        generateCommand({ project: 'test-project', cwd: dir }, 'env.ts')
      ).rejects.toThrow('only works when values.format is "ts"');
    });
  });

  test('versions each output and rewrites only when the version is lower', async () => {
    await withTempDir(async (dir) => {
      const ctx = { project: 'test-project', cwd: dir };
      const read = (name: string) => readFile(path.join(dir, name), 'utf8');
      await writeFile(path.join(dir, '.env'), '# env-manager: test-project | 2025-01-01T00:00:00Z\n\nFOO=bar # {string}\n');
      await generateCommand(ctx, 'env.ts');
      const reader = await read('env.ts');
      expect(reader.split('\n')[0]).toBe('// env-manager: test-project | v1');
      expect(await read('.env')).toBe('# env-manager: test-project | 2025-01-01T00:00:00Z\n# env-manager ts: env.ts\n\nFOO=bar # {string}\n');
      const local = await read('.env.local');
      expect(local.split('\n').slice(0, 3).map(line => line.replace(/[0-9a-f]{16}$/, '<hash>'))).toEqual([
        '# env-manager: test-project | v1',
        '# env-manager output: .env.local v1 <hash>',
        '# env-manager output: env.ts v1 <hash>',
      ]);

      const formatted = reader.replaceAll("'", '"').replace('  FOO: z.string(),', '    FOO: z.string(),');
      await writeFile(path.join(dir, 'env.ts'), formatted);
      await generateCommand(ctx);
      expect(await read('env.ts')).toBe(formatted);
      expect(await read('.env.local')).toBe(local);

      await writeFile(path.join(dir, 'env.ts'), formatted.replace('z.string()', 'z.url()'));
      await generateCommand(ctx);
      expect(await read('env.ts')).toBe(reader);
      expect(await read('.env.local')).toBe(local);

      await writeFile(path.join(dir, '.env'), '# env-manager: test-project\n# env-manager ts: env.ts\n\nFOO=bar # {string}\nBAR=1 # {int}\n');
      await generateCommand(ctx);
      const regenerated = await read('env.ts');
      expect(regenerated.split('\n')[0]).toBe('// env-manager: test-project | v2');
      expect(regenerated).toContain('  BAR: z.coerce.number().int(),');
    });
  });

  test('versions each target child separately', async () => {
    await withTempDir(async (dir) => {
      const ctx = { project: 'test-project', cwd: dir };
      const read = (name: string) => readFile(path.join(dir, name), 'utf8');
      await writeFile(path.join(dir, '.env'), [
        '# env-manager: test-project',
        '# env-manager target: client format=ts path=.env.local',
        '# env-manager target: server format=ts path=.env.local',
        '# env-manager targets: client',
        'FOO= # {string}',
        '# env-manager targets: server',
        'BAR= # {string}',
        '',
      ].join('\n'));
      await writeFile(path.join(dir, '.env.local'), 'FOO=one\nBAR=one\n');
      await generateCommand(ctx);
      const client = await read('client/.env.local');
      expect(client.split('\n')[0]).toBe('# env-manager: test-project | v1');
      expect(client).toContain("FOO='one' # {string}");

      const formatted = client.replace("FOO='one'", 'FOO="one"');
      await writeFile(path.join(dir, 'client/.env.local'), formatted);
      await writeFile(path.join(dir, '.env.local'), (await read('.env.local')).replace('BAR=one', 'BAR=two'));
      await generateCommand(ctx);
      expect(await read('client/.env.local')).toBe(formatted);
      const server = await read('server/.env.local');
      expect(server.split('\n')[0]).toBe('# env-manager: test-project | v2');
      expect(server).toContain("BAR='two' # {string}");
      expect((await read('.env.local')).split('\n')[0]).toBe('# env-manager: test-project | v2');
    });
  });

  test('switching environments leaves target readers untouched', async () => {
    await withTempDir(async (dir) => {
      const ctx = { project: 'test-project', cwd: dir };
      const read = (name: string) => readFile(path.join(dir, name), 'utf8');
      await writeFile(path.join(dir, '.env'), [
        '# env-manager: test-project',
        '# env-manager target: client format=ts generate=src/env.ts',
        '# env-manager targets: client',
        'FOO= # {string}',
        '',
      ].join('\n'));
      await writeFile(path.join(dir, '.env.local'), '# env-manager env: staging\nFOO=one\n');
      await generateCommand(ctx);
      const reader = await read('client/src/env.ts');
      expect(reader).not.toContain('env-manager env:');

      await writeFile(path.join(dir, '.env.local'), (await read('.env.local')).replace('env: staging', 'env: production'));
      await generateCommand(ctx);
      expect(await read('client/src/env.ts')).toBe(reader);
      expect(await read('client/.env.local')).toContain('# env-manager env: production');
    });
  });

  describe('.env.override', () => {
    const MONOREPO = [
      '# env-manager: test-project',
      '# env-manager target: client format=ts path=.env.local',
      '# env-manager targets: client',
      'PORT=3000 # {int:min(1)}',
      'HOST= # {optional string}',
      '',
    ].join('\n');

    test('applies to target outputs but never to the root values file', async () => {
      await withTempDir(async (dir) => {
        const ctx = { project: 'test-project', cwd: dir };
        const read = (name: string) => readFile(path.join(dir, name), 'utf8');
        await writeFile(path.join(dir, '.env'), MONOREPO);
        await writeFile(path.join(dir, '.env.local'), 'PORT=3000\n');
        await writeFile(path.join(dir, '.env.override'), 'PORT=4100\nHOST=wt.localhost\n');
        await generateCommand(ctx);
        expect(await read('client/.env.local')).toContain("PORT=4100 # {int:min(1)}");
        expect(await read('client/.env.local')).toContain("HOST='wt.localhost'");
        expect(await read('.env.local')).toContain('PORT=3000\n');
        expect(await read('.env.local')).not.toContain('4100');

        const child = await read('client/.env.local');
        await generateCommand(ctx);
        expect(await read('client/.env.local')).toBe(child);

        await writeFile(path.join(dir, '.env.override'), 'PORT=4200\n');
        await generateCommand(ctx);
        expect(await read('client/.env.local')).toContain('PORT=4200 ');
      });
    });

    test('rejects unknown keys, invalid values, and single-project setups', async () => {
      await withTempDir(async (dir) => {
        const ctx = { project: 'test-project', cwd: dir };
        await writeFile(path.join(dir, '.env'), MONOREPO);
        await writeFile(path.join(dir, '.env.local'), 'PORT=3000\n');
        const overridePath = path.join(dir, '.env.override');
        await writeFile(overridePath, 'PORT=4100\nPROT=1\n');
        await expect(generateCommand(ctx)).rejects.toThrow(`${overridePath}:2: Unknown variable PROT. Overrides must be declared in .env.`);
        await writeFile(overridePath, 'PORT=0\n');
        await expect(generateCommand(ctx)).rejects.toThrow(`${overridePath}:1: Invalid value for PORT`);
        expect(await Bun.file(path.join(dir, 'client/.env.local')).exists()).toBe(false);

        await writeFile(path.join(dir, '.env'), ENV_CONTENT);
        await writeFile(overridePath, 'FOO=x\n');
        await expect(generateCommand(ctx, 'env.ts')).rejects.toThrow(`${overridePath}:1: .env.override only applies to target outputs. Edit .env.local directly in a single-project setup.`);
      });
    });
  });
});
