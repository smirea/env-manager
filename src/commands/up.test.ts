import { describe, expect, test } from 'bun:test';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { puts, secrets, withTempDir } from '../test-setup';
import { downCommand } from './down';
import { envSetCommand } from './env';
import { generateCommand } from './generate';
import { upCommand } from './up';

const latestLocalOutput = () => puts.at(-1)?.environments?.local.outputs?.['.env.local'];

describe('up', () => {
	test('up writes to AWS only when the schema or values changed, each change bumps the version, and .env never carries one', async () => {
		await withTempDir(async dir => {
			const ctx = { project: 'demo', cwd: dir };
			const read = (name: string) => readFile(path.join(dir, name), 'utf8');
			await writeFile(path.join(dir, 'package.json'), '{}\n');
			await writeFile(path.join(dir, '.env'), '# env-manager: demo | 2025-01-01T00:00:00Z\n\nFOO= # {string}\n');
			await writeFile(path.join(dir, '.env.local'), 'FOO=one\n');
			const writes = puts.length;

			await upCommand(ctx);
			expect(puts.length - writes).toBe(1);
			expect(puts.at(-1)?.schema).toBe('# env-manager: demo\n\nFOO= # {string}\n');
			expect(latestLocalOutput()?.version).toBe(1);
			expect(await read('.env')).toBe('# env-manager: demo\n\nFOO= # {string}\n');
			expect(await read('.env.local')).toBe(
				`# env-manager: demo | v1\n# env-manager output: .env.local v1 ${latestLocalOutput()?.hash}\nFOO=one\n`,
			);

			await upCommand(ctx);
			expect(puts.length - writes).toBe(1);

			await writeFile(path.join(dir, '.env.local'), (await read('.env.local')).replace('FOO=one', 'FOO=two'));
			await upCommand(ctx);
			expect(puts.length - writes).toBe(2);
			expect(latestLocalOutput()?.version).toBe(2);

			await writeFile(path.join(dir, '.env.local'), 'FOO=stale\n');
			await downCommand(ctx);
			const local = await read('.env.local');
			expect(local.split('\n')[0]).toBe('# env-manager: demo | v2');
			expect(local).toContain("FOO='two' # {string}");
			expect(local).not.toMatch(/\d{4}-\d{2}-\d{2}/);
			expect(await read('.env')).toBe('# env-manager: demo\n\nFOO= # {string}\n');

			await downCommand(ctx);
			expect(await read('.env.local')).toBe(local);
			expect(puts.length - writes).toBe(2);
		});
	});

	test('up refuses to upload values loaded for a different environment than the selected one', async () => {
		await withTempDir(async dir => {
			const ctx = { project: 'refuse', cwd: dir };
			await writeFile(path.join(dir, 'package.json'), '{}\n');
			await writeFile(
				path.join(dir, '.env'),
				'# env-manager: refuse\n# env-manager target: server format=ts path=.env.local\n# env-manager targets: server\nAPP_ENV=development # {string}\n',
			);
			await writeFile(path.join(dir, '.env.local'), '# env-manager env: dev\n');
			await upCommand(ctx);
			secrets.get('env-manager/refuse')!.environments!.prod = {
				values: 'APP_ENV=production\n',
				syncDate: '2026-01-01T00:00:00Z',
			};
			await downCommand(ctx);

			await envSetCommand(ctx, 'prod', { local: true });
			await generateCommand(ctx);
			await expect(upCommand(ctx)).rejects.toThrow();
			expect(secrets.get('env-manager/refuse')?.environments?.prod?.values).toBe('APP_ENV=production\n');

			await downCommand(ctx);
			expect(await readFile(path.join(dir, 'server/.env.local'), 'utf8')).toContain("APP_ENV='production'");
			await upCommand(ctx);
		});
	});

	test('overrides never reach AWS and survive down', async () => {
		await withTempDir(async dir => {
			const ctx = { project: 'mono', cwd: dir };
			await writeFile(path.join(dir, 'package.json'), '{}\n');
			await writeFile(
				path.join(dir, '.env'),
				'# env-manager: mono\n# env-manager target: web format=ts path=.env.local\n# env-manager targets: web\nPORT=3000 # {int}\n',
			);
			await writeFile(path.join(dir, '.env.local'), '# env-manager env: local\nPORT=3000\n');
			await writeFile(path.join(dir, '.env.override'), 'PORT=4100\n');

			await upCommand(ctx);
			expect(secrets.get('env-manager/mono')?.environments?.local.values).not.toContain('4100');
			await writeFile(path.join(dir, '.env.local'), '# env-manager env: local\nPORT=9999\n');
			await downCommand(ctx);
			expect(await readFile(path.join(dir, '.env.local'), 'utf8')).toContain('PORT=3000');
			expect(await readFile(path.join(dir, 'web/.env.local'), 'utf8')).toContain('PORT=4100 ');
		});
	});
});
