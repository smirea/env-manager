import { describe, expect, test } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { NotInitializedError } from '../errors';
import { secrets, withTempDir } from '../test-setup';
import { collectInfo } from './info';

describe('info', () => {
	test('info describes the selected environment, overrides, targets and each variable, and reads no storage in local mode', async () => {
		await withTempDir(async dir => {
			await writeFile(
				path.join(dir, '.env'),
				[
					'# env-manager: demo',
					'# env-manager target: ios format=swift',
					'# env-manager target: web format=ts',
					'# env-manager targets: ios,web',
					'API_URL=https://example.com # {url}',
					'# env-manager targets: web',
					'PORT= # {optional int}',
					'',
				].join('\n'),
			);
			await writeFile(
				path.join(dir, '.env.local'),
				'# env-manager env: prod\n# env-manager values env: prod\nAPI_URL=https://prod.example.com\n',
			);
			await writeFile(path.join(dir, '.env.override'), 'API_URL=http://127.0.0.1:1\n');

			const info = await collectInfo({ project: 'demo', cwd: dir }, { local: true });
			expect(info.environment).toEqual({ current: 'prod', valuesLoadedFrom: 'prod' });
			expect(info.environments).toBe(null);
			expect(info.override?.variables).toEqual(['API_URL']);
			expect(info.targets.map(t => [t.name, t.format, t.variables])).toEqual([
				['ios', 'swift', ['API_URL']],
				['web', 'ts', ['API_URL', 'PORT']],
			]);
			expect(info.variables).toEqual([
				{ name: 'API_URL', type: 'url', optional: false, default: 'https://example.com', targets: ['ios', 'web'] },
				{ name: 'PORT', type: 'int', optional: true, default: null, targets: ['web'] },
			]);
		});
	});

	test('a .env without a project header is the no-setup case, which exits 3, not a broken setup', async () => {
		await withTempDir(async dir => {
			await writeFile(path.join(dir, 'package.json'), '{}\n');
			await writeFile(path.join(dir, '.env'), '# env-manager local: true\nPORT=3000 # {int}\n');
			await expect(collectInfo({ project: 'My App', cwd: dir }, { local: true })).rejects.toBeInstanceOf(
				NotInitializedError,
			);
			expect(NotInitializedError.exitCode).toBe(3);
		});
	});

	test('info reports whether down would replace .env with a different stored schema', async () => {
		await withTempDir(async dir => {
			const ctx = { project: 'drift', cwd: dir };
			const schema = '# env-manager: drift | 2025-01-01T00:00:00Z\n# env-manager format: swift\n\nFOO= # {string}\n';
			await writeFile(path.join(dir, '.env'), schema);
			expect((await collectInfo(ctx, { local: false })).storedSchema).toBe('missing');
			secrets.set('env-manager/drift', {
				schema: schema.replace(' | 2025-01-01T00:00:00Z', ''),
				environments: { prod: { values: 'FOO=a\n', syncDate: '2026-01-01T00:00:00Z' } },
			});
			const info = await collectInfo(ctx, { local: false });
			expect([info.storedSchema, info.environments]).toEqual(['in-sync', ['prod']]);
			secrets.set('env-manager/drift', {
				schema: '# env-manager: drift\n# env-manager format: swift\n\nOLD= # {string}\n',
			});
			expect((await collectInfo(ctx, { local: false })).storedSchema).toBe('differs');
		});
	});
});
