import { describe, expect, test } from 'bun:test';
import type { EnvVarSchema } from './parser';
import { assertValid, validateValue } from './validator';

function entry(type: EnvVarSchema['type'], overrides: Partial<EnvVarSchema> = {}): EnvVarSchema {
	return { name: 'VAR', type, optional: false, validators: [], defaultValue: null, lineNumber: 1, ...overrides };
}

describe('validateValue', () => {
	test('ints are whole numbers within the safe range, and floats accept a leading-dot decimal', () => {
		for (const bad of ['12abc', '1.2', '9007199254740993']) expect(validateValue(entry('int'), bad)).not.toBeNull();
		expect(validateValue(entry('int'), '-7')).toBeNull();
		expect(validateValue(entry('float'), '1.2.3')).not.toBeNull();
		expect(validateValue(entry('float'), '.5')).toBeNull();
	});

	test('min and max compare numerically and are inclusive bounds', () => {
		const bounded = entry('int', {
			validators: [
				{ kind: 'min', value: 10 },
				{ kind: 'max', value: 20 },
			],
		});
		expect(validateValue(bounded, '9')).not.toBeNull();
		expect(validateValue(bounded, '21')).not.toBeNull();
		expect(validateValue(bounded, '10')).toBeNull();
		expect(validateValue(bounded, '20')).toBeNull();
	});

	test('url, email and bool values must parse as their type', () => {
		expect(validateValue(entry('url'), 'not a url')).not.toBeNull();
		expect(validateValue(entry('email'), 'a@b')).not.toBeNull();
		expect(validateValue(entry('bool'), 'maybe')).not.toBeNull();
		expect(validateValue(entry('bool'), 'off')).toBeNull();
	});

	test('a format with the global flag gives the same answer every time', () => {
		const token = entry('string', { validators: [{ kind: 'format', pattern: /foo/g }] });
		expect(validateValue(token, 'foo')).toBeNull();
		expect(validateValue(token, 'foo')).toBeNull();
	});
});

describe('assertValid', () => {
	test('a required variable needs a value or a schema default, and every failing variable is named', () => {
		const schema = [
			entry('string', { name: 'REQUIRED' }),
			entry('string', { name: 'OPTIONAL', optional: true }),
			entry('int', { name: 'DEFAULTED', defaultValue: '3' }),
		];
		expect(() => assertValid(schema, { REQUIRED: '', DEFAULTED: 'x' })).toThrow(/REQUIRED[\s\S]*DEFAULTED/);
		expect(() => assertValid(schema, { REQUIRED: 'x' })).not.toThrow();
	});
});
