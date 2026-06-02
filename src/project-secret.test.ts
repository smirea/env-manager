import { describe, expect, test } from 'bun:test';
import {
  createProjectSecretPayload,
  getProjectEnvironment,
  listProjectEnvironments,
  normalizeProjectSecret,
} from './project-secret';
import type { SecretPayload } from './types';

const LEGACY_PAYLOAD: SecretPayload = {
  schema: `# env-manager: demo | 2026-01-01T00:00:00Z
# env-manager env: prod

API_KEY= # {string}
`,
  values: 'API_KEY=secret',
  syncDate: '2026-01-02T00:00:00Z',
  files: { CERT: 'cert' },
};

describe('project secret payloads', () => {
  test('normalizes legacy project values into local environment', () => {
    const normalized = normalizeProjectSecret(LEGACY_PAYLOAD);

    expect(normalized.schema).not.toContain('# env-manager env:');
    expect(normalized.environments).toEqual({
      local: {
        values: 'API_KEY=secret',
        syncDate: '2026-01-02T00:00:00Z',
        files: { CERT: 'cert' },
      },
    });
  });

  test('lists environments from new payloads', () => {
    expect(
      listProjectEnvironments({
        schema: LEGACY_PAYLOAD.schema,
        environments: {
          prod: { values: '', syncDate: '2026-01-01T00:00:00Z' },
          local: { values: '', syncDate: '2026-01-01T00:00:00Z' },
        },
      })
    ).toEqual(['local', 'prod']);
  });

  test('returns a selected environment or fails clearly', () => {
    const payload = createProjectSecretPayload(LEGACY_PAYLOAD.schema, {
      prod: { values: 'API_KEY=prod', syncDate: '2026-01-03T00:00:00Z' },
    });

    expect(getProjectEnvironment('demo', payload, 'prod').values).toBe(
      'API_KEY=prod'
    );
    expect(() => getProjectEnvironment('demo', payload, 'local')).toThrow(
      'Environment "local" not found for project "demo"'
    );
  });
});
