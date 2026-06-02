import { describe, expect, test } from 'bun:test';
import {
  collectStoredFiles,
  formatProjectPrintOutput,
} from './print';
import type { SecretPayload } from '../types';
import { parseEnvFile, parseEnvValues } from '../parser';

function createPayload(overrides: Partial<SecretPayload> = {}): SecretPayload {
  return {
    schema: `# env-manager: demo | 2026-03-07T00:00:00Z

API_KEY= # {string}
CERT=secrets/cert.pem # {file}
EXTRA_CERT= # {file}
`,
    values: `API_KEY=secret
EXTRA_CERT=config/extra.pem`,
    syncDate: '2026-03-07T00:00:00Z',
    files: {
      CERT: 'primary cert',
      EXTRA_CERT: 'secondary cert',
    },
    ...overrides,
  };
}

describe('print command formatting', () => {
  test('collects file paths from schema defaults and local values', () => {
    const payload = createPayload();
    const parsed = parseEnvFile(payload.schema);
    const values = parseEnvValues(payload.values ?? '');
    const files = collectStoredFiles(parsed.schema, values, payload.files);

    expect(files).toEqual([
      {
        name: 'CERT',
        path: 'secrets/cert.pem',
        content: 'primary cert',
      },
      {
        name: 'EXTRA_CERT',
        path: 'config/extra.pem',
        content: 'secondary cert',
      },
    ]);
  });

  test('prints env sections and file contents separately', () => {
    const output = formatProjectPrintOutput('demo', createPayload());

    expect(output).toContain('project: demo');
    expect(output).toContain('---- env: local ----');
    expect(output).toContain(
      '.env\n# env-manager: demo | 2026-03-07T00:00:00Z'
    );
    expect(output).not.toContain(
      '.env\n# env-manager: demo | 2026-03-07T00:00:00Z\n# env-manager env: local'
    );
    expect(output).toContain(
      '.env.local\n# env-manager: demo | 2026-03-07T00:00:00Z\n# env-manager env: local'
    );
    expect(output).toContain("API_KEY='secret' # {string}");
    expect(output).toContain("EXTRA_CERT='config/extra.pem' # {file}");
    expect(output).toContain('files\nname: CERT\npath: secrets/cert.pem\ncontents:\nprimary cert');
    expect(output).toContain(
      'name: EXTRA_CERT\npath: config/extra.pem\ncontents:\nsecondary cert'
    );
  });

  test('shows missing content and unknown paths when stored payload is inconsistent', () => {
    const output = formatProjectPrintOutput(
      'demo',
      createPayload({
        files: {
          EXTRA_CERT: 'secondary cert',
          ORPHAN_FILE: 'orphan content',
        },
      })
    );

    expect(output).toContain(
      'name: CERT\npath: secrets/cert.pem\ncontents:\n(missing stored content)'
    );
    expect(output).toContain(
      'name: ORPHAN_FILE\npath: (unknown path)\ncontents:\norphan content'
    );
  });

  test('prints each environment from the project payload', () => {
    const output = formatProjectPrintOutput('demo', {
      schema: createPayload().schema,
      environments: {
        local: {
          values: 'API_KEY=local',
          syncDate: '2026-03-07T00:00:00Z',
        },
        prod: {
          values: 'API_KEY=prod',
          syncDate: '2026-03-08T00:00:00Z',
        },
      },
    });

    expect(output).toContain('---- env: local ----');
    expect(output).toContain("API_KEY='local' # {string}");
    expect(output).toContain('---- env: prod ----');
    expect(output).toContain("API_KEY='prod' # {string}");
  });

  test('can print only one selected environment', () => {
    const output = formatProjectPrintOutput(
      'demo',
      {
        schema: createPayload().schema,
        environments: {
          local: {
            values: 'API_KEY=local',
            syncDate: '2026-03-07T00:00:00Z',
          },
          prod: {
            values: 'API_KEY=prod',
            syncDate: '2026-03-08T00:00:00Z',
          },
        },
      },
      { environment: 'prod' }
    );

    expect(output).toContain('---- env: prod ----');
    expect(output).toContain("API_KEY='prod' # {string}");
    expect(output).not.toContain('---- env: local ----');
    expect(output).not.toContain("API_KEY='local' # {string}");
  });
});
