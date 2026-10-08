import { describe, expect, test } from 'bun:test';
import { formatRootConfig, parseRootConfig, schemaForTarget } from './config';

const MONOREPO = `# env-manager: demo
# env-manager local:true
# env-manager target: ios format=swift
# env-manager target: client format=ts
# env-manager target: server format=ts path=config/.env.local
# env-manager targets: *
API_URL=https://example.com # {url}
# env-manager targets: client
CLIENT_SETTING= # {optional string}
# env-manager targets: server
DATABASE_URL= # {url}
`;

describe('root config validation', () => {
  test('scopes replace previous selections and empty selections count as target use', () => {
    const config = parseRootConfig(MONOREPO, 'root.env');
    expect(schemaForTarget(config, 'client').map(s => s.name)).toEqual(['API_URL', 'CLIENT_SETTING']);
    expect(schemaForTarget(config, 'server').map(s => s.name)).toEqual(['API_URL', 'DATABASE_URL']);
    expect(schemaForTarget(config, 'ios').map(s => s.name)).toEqual(['API_URL']);
    const empty = parseRootConfig('# env-manager target: ios format=swift\n# env-manager targets: ios\n');
    expect(schemaForTarget(empty, 'ios')).toEqual([]);
  });

  test('local alone keeps untyped legacy variables usable and strict check reports them', () => {
    const content = '# env-manager: demo | 2026-01-01T00:00:00Z\n# env-manager local:true\nUNTYPED=legacy\n';
    expect(parseRootConfig(content).modern).toBe(false);
    expect(() => parseRootConfig('  # env-manager format: ts\nUNTYPED=legacy\n')).toThrow('needs a type');
    expect(() => parseRootConfig(content, 'root.env', true)).toThrow('root.env:3: Variable UNTYPED needs a type');
  });

  test('rejects ambiguous scopes, config, schema and defaults with source locations', () => {
    const cases = [
      ['# env-manager local:yes', 'local must be true or false'],
      ['# env-manager local:true\n# env-manager local:false', 'Duplicate'],
      ['# env-manager forma:ts', 'Unknown'],
      ['# env-manager target: client format=ts\nA= # {string}\n# env-manager targets: client', 'Select targets before defining'],
      ['# env-manager target: client format=ts\n# env-manager targets: clients', 'Unknown target'],
      ['# env-manager target: client format=ts\n# env-manager targets: client,client', 'Repeated target'],
      ['# env-manager target: client format=ts\n# env-manager targets:', 'Empty target selection'],
      ['# env-manager target: client format=ts', 'never selected'],
      ['# env-manager target: client format=ts\n# env-manager target: client format=ts', 'Duplicate target'],
      ['# env-manager target: client format=ts what=foo', 'Unknown or malformed target field'],
      ['# env-manager target: ../client format=ts', 'Invalid target'],
      ['# env-manager target: ios format=swift generate=env.ts', 'only supported'],
      ['# env-manager format: ts\n# env-manager values.format: ts', 'conflicting'],
      ['# env-manager path: ../secrets', 'must be relative'],
      ['# env-manager generate: /tmp/env.ts', 'must be relative'],
      ['# env-manager format: swift\n# env-manager target: ios format=swift', 'cannot be mixed'],
      ['# env-manager format: ts\nA=foo', 'needs a type'],
      ['A= # {string}\nA= # {string}', 'Duplicate variable'],
      ['A= # {unknown}', 'Malformed schema'],
      ['A= # {string:min(1)}', 'not valid'],
      ['A= # {int:min(1junk)}', 'Invalid min'],
      ['A=2 # {int:min(3)}', 'Invalid default'],
      ['A= # {int:min(3),max(2)}', 'min() exceeds max()'],
      ['# env-manager nonsense', 'Malformed'],
    ];
    for (const [content, reason] of cases) {
      expect(() => parseRootConfig(content, 'root.env')).toThrow(reason);
      expect(() => parseRootConfig(content, 'root.env')).toThrow(/root.env:\d+:/);
    }
  });

  test('validates regex grouping and character classes without confusing validator delimiters', () => {
    const config = parseRootConfig('TOKEN= # {string:format(/^sk-(foo|bar)[/)]+$/)}\n');
    expect(config.schema[0].validators[0].kind).toBe('format');
  });

  test('format preserves raw values, comments, and scope ordering, and is idempotent', () => {
    const content = `# notes stay here
# env-manager: demo
# env-manager target:   client  format=ts
# env-manager targets: client
  TOKEN = 'spaces # and \\'quotes'    # { optional string }
# normal comment
# env-manager targets: client
URL = 'https://example.com' # {url}
`;
    const formatted = formatRootConfig(content, 'root.env');
    expect(formatted).toContain("TOKEN='spaces # and \\'quotes' # {optional string}");
    expect(formatted).toContain('# normal comment');
    expect(formatted.indexOf('TOKEN=')).toBeLessThan(formatted.lastIndexOf('# env-manager targets: client'));
    expect(formatRootConfig(formatted, 'root.env')).toBe(formatted);
    expect(parseRootConfig(formatted).schema.map(s => s.defaultValue)).toEqual(parseRootConfig(content).schema.map(s => s.defaultValue));
  });
});
