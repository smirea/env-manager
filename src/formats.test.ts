import { describe, expect, test } from 'bun:test';
import { FORMATS } from './formats';
import { parseEnvValues, type EnvVarSchema } from './parser';

const schema: EnvVarSchema[] = ['GIPHY_API_KEY', 'GEMINI_API_KEY'].map((name, index) => ({
  name, type: 'string', optional: false, validators: [], defaultValue: null, lineNumber: index + 1,
}));

describe('ts values', () => {
  test('ts values carry their schema comment, leave numbers unquoted, keep extra keys, and parse back', () => {
    const entry = (name: string, type: 'string' | 'int' | 'float' | 'bool', lineNumber: number) =>
      ({ name, type, optional: false, validators: [], defaultValue: null, lineNumber });
    const values = { API_KEY: 'sk-test', PORT: '3000', THRESHOLD: '0.25', ENABLED: 'true', NAME: "C:\\O'Reilly", EXTRA: 'yes' };
    const content = FORMATS.ts.render(
      [entry('API_KEY', 'string', 1), entry('PORT', 'int', 2), entry('THRESHOLD', 'float', 3), entry('ENABLED', 'bool', 4), entry('NAME', 'string', 5)],
      values,
    );
    expect(content).toBe(`API_KEY='sk-test' # {string}
PORT=3000 # {int}
THRESHOLD=0.25 # {float}
ENABLED='true' # {bool}
NAME='C:\\\\O\\'Reilly' # {string}
EXTRA='yes'
`);
    expect(parseEnvValues(content)).toEqual(values);
  });
});

describe('swift values', () => {
  test('swift values render in schema order with extra keys last, and parse back ignoring comments', () => {
    const content = FORMATS.swift.render(schema, { EXTRA: 'kept', GEMINI_API_KEY: 'gemini-secret', GIPHY_API_KEY: 'giphy-secret' });
    expect(content).toBe('GIPHY_API_KEY = giphy-secret\nGEMINI_API_KEY = gemini-secret\nEXTRA = kept\n');
    expect(FORMATS.swift.parse(`// local secrets\n${content}`)).toEqual({ GIPHY_API_KEY: 'giphy-secret', GEMINI_API_KEY: 'gemini-secret', EXTRA: 'kept' });
  });

  test('swift values write // as /$()/ so xcconfig does not read it as a comment, and parse back to //', () => {
    const content = FORMATS.swift.render([], { API_URL: 'https://example.com', TOKEN: 'abc//def' });
    expect(content).toBe('API_URL = https:/$()/example.com\nTOKEN = abc/$()/def\n');
    expect(FORMATS.swift.parse(content)).toEqual({ API_URL: 'https://example.com', TOKEN: 'abc//def' });
  });
});
