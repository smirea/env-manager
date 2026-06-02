import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  DEFAULT_ENVIRONMENT,
  parseEnvironmentComment,
  removeEnvironmentFromContent,
  resolveEnvironment,
  resolveEnvironmentFromContent,
  upsertEnvironmentInContent,
  validateEnvironmentName,
} from './environment';

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'env-manager-env-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

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

  test('resolves from .env.local and ignores .env', async () => {
    await withTempDir(async (dir) => {
      await writeFile(path.join(dir, '.env'), '# env-manager env: prod\n');
      await writeFile(path.join(dir, '.env.local'), '# env-manager env: staging\n');

      expect(await resolveEnvironment(dir)).toBe('staging');
    });
  });

  test('defaults to local when .env.local is missing', async () => {
    await withTempDir(async (dir) => {
      await writeFile(path.join(dir, '.env'), '# env-manager env: prod\n');

      expect(await resolveEnvironment(dir)).toBe(DEFAULT_ENVIRONMENT);
    });
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
