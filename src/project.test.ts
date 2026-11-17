import { expect, test } from 'bun:test';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { withTempDir } from './test-setup';
import { moveSelectionOutOfSchema } from './project';

test('an env directive in the tracked .env moves to the values file, or is dropped when the values file already selects one', async () => {
	await withTempDir(async dir => {
		const ctx = { project: 'demo', cwd: dir };
		const read = (name: string) => readFile(path.join(dir, name), 'utf8');
		const schema = '# env-manager: demo\nPORT=3000 # {int}\n';
		await writeFile(path.join(dir, 'package.json'), '{}\n');
		const tracked = (environment: string) => schema.replace('\n', `\n# env-manager env: ${environment}\n`);

		await writeFile(path.join(dir, '.env'), tracked('staging'));
		await moveSelectionOutOfSchema(ctx, tracked('staging'));
		expect(await read('.env')).toBe(schema);
		expect(await read('.env.local')).toContain('# env-manager env: staging\n');

		const values = await read('.env.local');
		await writeFile(path.join(dir, '.env'), tracked('prod'));
		await moveSelectionOutOfSchema(ctx, tracked('prod'));
		expect(await read('.env')).toBe(schema);
		expect(await read('.env.local')).toBe(values);
	});
});
