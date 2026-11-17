import { describe, expect, test } from 'bun:test';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { secrets, withTempDir } from '../test-setup';
import { envSetCommand } from './env';
import { upCommand } from './up';

const SCHEMA =
	'# env-manager: envs\n# env-manager target: server format=ts path=.env.local\n# env-manager targets: server\nAPP_ENV=development # {string}\n';

async function withProject(
	fn: (ctx: { project: string; cwd: string }, read: (name: string) => Promise<string>) => Promise<void>,
) {
	await withTempDir(async dir => {
		secrets.delete('env-manager/envs');
		await writeFile(path.join(dir, 'package.json'), '{}\n');
		await writeFile(path.join(dir, '.env'), SCHEMA);
		await writeFile(path.join(dir, '.env.local'), '# env-manager env: dev\n');
		await fn({ project: 'envs', cwd: dir }, name => readFile(path.join(dir, name), 'utf8'));
	});
}

describe('env set', () => {
	test('env set to a stored environment downloads it and regenerates the children', async () => {
		await withProject(async (ctx, read) => {
			await upCommand(ctx);
			secrets.get('env-manager/envs')!.environments!.prod = {
				values: 'APP_ENV=production\n',
				syncDate: '2026-01-01T00:00:00Z',
			};

			await envSetCommand(ctx, 'prod');
			expect(await read('.env.local')).toContain('# env-manager env: prod\n# env-manager values env: prod\n');
			expect(await read('.env.local')).toContain("APP_ENV='production'");
			expect(await read('server/.env.local')).toContain("# env-manager env: prod\nAPP_ENV='production' # {string}\n");
		});
	});

	test('env set to an environment that is not stored keeps the current values, and the next up creates it from them', async () => {
		await withProject(async (ctx, read) => {
			await writeFile(path.join(ctx.cwd, '.env.local'), '# env-manager env: dev\nAPP_ENV=production\n');
			await upCommand(ctx);
			await envSetCommand(ctx, 'prod');
			await upCommand(ctx);
			expect(secrets.get('env-manager/envs')?.environments?.prod?.values).toBe("APP_ENV='production'");
			expect(await read('server/.env.local')).toContain("# env-manager env: prod\nAPP_ENV='production'");
		});
	});
});
