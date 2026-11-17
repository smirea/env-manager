import { describe, expect, test } from 'bun:test';
import {
	envValuesEqual,
	parseEnvFile,
	parseEnvValues,
	parseSchemaComment,
	SCHEMA_TYPES,
	serializeEnvValues,
} from './parser';

describe('parseSchemaComment', () => {
	test('a schema comment is an optional prefix, a type, and validators', () => {
		for (const type of SCHEMA_TYPES) {
			expect(parseSchemaComment(`# {${type}}`)).toEqual({ type, optional: false, validators: [] });
		}
		expect(parseSchemaComment('# {optional int:min(-100),max(10000)}')).toEqual({
			type: 'int',
			optional: true,
			validators: [
				{ kind: 'min', value: -100 },
				{ kind: 'max', value: 10000 },
			],
		});
		expect(parseSchemaComment('# {float:min(0.5),max(1.0)}')?.validators).toEqual([
			{ kind: 'min', value: 0.5 },
			{ kind: 'max', value: 1 },
		]);
		expect(parseSchemaComment('# {string:format(/^openai-key_\\w+/)}')?.validators).toEqual([
			{ kind: 'format', pattern: /^openai-key_\w+/ },
		]);
		expect(parseSchemaComment('# {string:format(/test/gi)}')?.validators).toEqual([
			{ kind: 'format', pattern: /test/gi },
		]);
	});

	test('a comment without a known type is not a schema', () => {
		expect(parseSchemaComment('# regular comment')).toBeNull();
		expect(parseSchemaComment('# {invalid}')).toBeNull();
	});

	test('validators that are unknown, malformed, or wrong for the type are rejected', () => {
		for (const comment of [
			'# {int:unknown(1)}',
			'# {string:min(1)}',
			'# {int:format(/^x/)}',
			'# {int:min(1),oops}',
			'# {string:format(invalid)}',
		]) {
			expect(() => parseSchemaComment(comment)).toThrow();
		}
	});
});

describe('parseEnvFile', () => {
	test('the project comes from the env-manager header, even after other comments', () => {
		expect(parseEnvFile('# comment\n# env-manager: test-project | v3\n\nFOO=bar # {string}\n').project).toBe(
			'test-project',
		);
		expect(parseEnvFile('').project).toBeNull();
	});

	test('a variable takes its schema from the same line or the line before, and a blank line drops a pending schema', () => {
		const content = `FOO= # {optional float}
# {string}
BAR='some default value'
PORT=3000 # {int:min(3000),max(10000)}
UNTYPED=bar
# {string}

DROPPED=bar
`;
		const { schema } = parseEnvFile(content);
		expect(schema.map(s => [s.name, s.type, s.optional, s.defaultValue])).toEqual([
			['FOO', 'float', true, null],
			['BAR', 'string', false, 'some default value'],
			['PORT', 'int', false, '3000'],
		]);
	});

	test('defaults may be quoted, and a # inside quotes or an apostrophe in an unquoted value belongs to the value', () => {
		const { schema } = parseEnvFile(`FOO='hello world' # {string}
BAR="hash#inside" # {string}
NAME=O'Brien # {string}
`);
		expect(schema.map(s => s.defaultValue)).toEqual(['hello world', 'hash#inside', "O'Brien"]);
	});
});

describe('parseEnvValues', () => {
	test('values follow dotenv quoting: quotes and escapes are undone, and # starts a comment only after whitespace outside quotes', () => {
		expect(
			parseEnvValues(`# comment
FOO=bar # comment
EMPTY=

BAR="hash#inside" # keep
BAZ=qux#not-comment
QUOTED='it\\'s fine' # comment
PATH_LIKE='C:\\\\secrets\\\\key'
NAME=O'Brien # note
`),
		).toEqual({
			FOO: 'bar',
			EMPTY: '',
			BAR: 'hash#inside',
			BAZ: 'qux#not-comment',
			QUOTED: "it's fine",
			PATH_LIKE: 'C:\\secrets\\key',
			NAME: "O'Brien",
		});
	});

	test('serialized values parse back unchanged and compare by key and value regardless of order', () => {
		const values = { PASS: 'abc #def', QUOTED: "'x'", SPACED: ' lead', PORT: '3000' };
		expect(parseEnvValues(serializeEnvValues(values))).toEqual(values);
		expect(envValuesEqual({ FOO: 'one', BAR: 'two' }, { BAR: 'two', FOO: 'one' })).toBe(true);
		expect(envValuesEqual({ FOO: 'one' }, { FOO: 'two' })).toBe(false);
	});
});
