import { expect, test } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadOwnEnv } from './env-loader';
import { withTempDir } from './test-setup';

const NAMES = ['AWS_REGION', 'SHARED_KEY', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'];

test("env-manager's own .env.local, then its .env, override what Bun loaded from the working directory, but an empty placeholder never clears a shell value", async () => {
	const previous = Object.fromEntries(NAMES.map(name => [name, process.env[name]]));
	await withTempDir(async dir => {
		await writeFile(
			path.join(dir, '.env'),
			'AWS_REGION=from-dot-env\nSHARED_KEY=from-dot-env\nAWS_SECRET_ACCESS_KEY= # {string}\n',
		);
		await writeFile(path.join(dir, '.env.local'), 'AWS_REGION=from-dot-env-local\nAWS_ACCESS_KEY_ID=own-access-key\n');
		process.env.AWS_REGION = 'from-cwd';
		process.env.SHARED_KEY = 'from-cwd';
		process.env.AWS_ACCESS_KEY_ID = 'from-cwd';
		process.env.AWS_SECRET_ACCESS_KEY = 'from-shell';

		loadOwnEnv(dir);

		expect(process.env.AWS_REGION).toBe('from-dot-env-local');
		expect(process.env.SHARED_KEY).toBe('from-dot-env');
		expect(process.env.AWS_ACCESS_KEY_ID).toBe('own-access-key');
		expect(process.env.AWS_SECRET_ACCESS_KEY).toBe('from-shell');
	}).finally(() => {
		for (const [name, value] of Object.entries(previous)) {
			if (value === undefined) delete process.env[name];
			else process.env[name] = value;
		}
	});
});
