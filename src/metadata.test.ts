import { describe, expect, test } from 'bun:test';
import { ensureHeader, parseHeader, setHeaderVersion } from './metadata';

describe('parseHeader', () => {
	test('a header names the project and an optional version, and a legacy sync date reads as no version', () => {
		expect(parseHeader('# env-manager: my_cool-project | v12')).toEqual({ project: 'my_cool-project', version: 12 });
		expect(parseHeader('# env-manager: my-project | 2025-01-15T10:30:00-05:00')).toEqual({
			project: 'my-project',
			version: null,
		});
		expect(parseHeader('# env-manager: my-project')).toEqual({ project: 'my-project', version: null });
		expect(parseHeader('# just a comment')).toBeNull();
		expect(parseHeader('FOO=bar')).toBeNull();
	});
});

describe('setHeaderVersion', () => {
	test('a version replaces a legacy sync date, finds the header after leading comments, and a missing header is added', () => {
		expect(setHeaderVersion('# comment\n# env-manager: demo | v1\n\nFOO=bar\n', 2)).toBe(
			'# comment\n# env-manager: demo | v2\n\nFOO=bar\n',
		);
		expect(setHeaderVersion('# env-manager: demo | 2025-01-01T00:00:00Z\n', 4)).toBe('# env-manager: demo | v4\n');
		expect(ensureHeader('FOO=bar\n', 'demo')).toBe('# env-manager: demo\n\nFOO=bar\n');
	});
});
