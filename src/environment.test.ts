import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_ENVIRONMENT,
  parseEnvironmentComment,
  removeEnvironmentFromContent,
  resolveEnvironmentFromContent,
  upsertEnvironmentInContent,
  validateEnvironmentName,
} from './environment';

describe('environment metadata', () => {
  test('defaults to local when no env comment exists', () => {
    expect(
      resolveEnvironmentFromContent(`# env-manager: demo | 2026-01-01T00:00:00Z

FOO=bar # {string}
`)
    ).toBe(DEFAULT_ENVIRONMENT);
  });

  test('parses an env comment', () => {
    expect(parseEnvironmentComment('# env-manager env: staging')).toBe(
      'staging'
    );
  });

  test('inserts env comment after the main header', () => {
    const content = upsertEnvironmentInContent(
      `# env-manager: demo | 2026-01-01T00:00:00Z
# env-manager ts: src/env.ts

FOO=bar # {string}
`,
      'prod'
    );

    expect(content.split('\n').slice(0, 3)).toEqual([
      '# env-manager: demo | 2026-01-01T00:00:00Z',
      '# env-manager env: prod',
      '# env-manager ts: src/env.ts',
    ]);
  });

  test('updates an existing env comment', () => {
    const content = upsertEnvironmentInContent(
      `# env-manager: demo | 2026-01-01T00:00:00Z
# env-manager env: staging
`,
      'prod'
    );

    expect(content).toContain('# env-manager env: prod');
    expect(content).not.toContain('# env-manager env: staging');
  });

  test('removes env comment from stored schema content', () => {
    expect(
      removeEnvironmentFromContent(`# env-manager: demo | 2026-01-01T00:00:00Z
# env-manager env: prod
# env-manager ts: src/env.ts
`).trim()
    ).toBe(`# env-manager: demo | 2026-01-01T00:00:00Z
# env-manager ts: src/env.ts`);
  });

  test('rejects spaces and pipe characters', () => {
    expect(() => validateEnvironmentName('prod east')).toThrow();
    expect(() => validateEnvironmentName('prod|east')).toThrow();
  });
});
