import { describe, expect, test } from 'bun:test';
import type { EnvVarSchema } from './parser';
import { validateEnv, validateValue } from './validator';

function entry(type: EnvVarSchema['type'], overrides: Partial<EnvVarSchema> = {}): EnvVarSchema {
  return { name: 'VAR', type, optional: false, validators: [], defaultValue: null, lineNumber: 1, ...overrides };
}

describe('validateValue', () => {
  test('ints must be whole numbers within the safe range', () => {
    expect(validateValue(entry('int'), '12abc')).toBe('Cannot parse "12abc" as int');
    expect(validateValue(entry('int'), '1.2')).toBe('Cannot parse "1.2" as int');
    expect(validateValue(entry('int'), '9007199254740993')).toBe('Cannot parse "9007199254740993" as int');
    expect(validateValue(entry('int'), '-7')).toBeNull();
  });

  test('floats accept leading-dot decimals and reject garbage', () => {
    expect(validateValue(entry('float'), '1.2.3')).toBe('Cannot parse "1.2.3" as float');
    expect(validateValue(entry('float'), '.5')).toBeNull();
  });

  test('min and max compare numerically', () => {
    const bounded = entry('int', { validators: [{ kind: 'min', value: 10 }, { kind: 'max', value: 20 }] });
    expect(validateValue(bounded, '9')).toBe('Value 9 is less than min(10)');
    expect(validateValue(bounded, '21')).toBe('Value 21 is greater than max(20)');
    expect(validateValue(bounded, '15')).toBeNull();
  });

  test('url, email and bool values are checked', () => {
    expect(validateValue(entry('url'), 'not a url')).toBe('Value "not a url" is not a valid URL');
    expect(validateValue(entry('email'), 'a@b')).toBe('Value "a@b" is not a valid email');
    expect(validateValue(entry('bool'), 'maybe')).toBe('Cannot parse "maybe" as bool');
    expect(validateValue(entry('bool'), 'off')).toBeNull();
  });

  test('format validators with the global flag give the same answer every time', () => {
    const token = entry('string', { validators: [{ kind: 'format', pattern: /foo/g }] });
    expect(validateValue(token, 'foo')).toBeNull();
    expect(validateValue(token, 'foo')).toBeNull();
  });
});

describe('validateEnv', () => {
  test('requires non-optional values, falling back to schema defaults', () => {
    const schema = [
      entry('string', { name: 'REQUIRED' }),
      entry('string', { name: 'OPTIONAL', optional: true }),
      entry('int', { name: 'DEFAULTED', defaultValue: '3' }),
    ];
    expect(validateEnv(schema, { REQUIRED: '' })).toEqual([{ varName: 'REQUIRED', message: 'Required variable REQUIRED is not set' }]);
    expect(validateEnv(schema, { REQUIRED: 'x' })).toEqual([]);
  });
});
