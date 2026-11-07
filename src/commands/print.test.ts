import { describe, expect, spyOn, test } from 'bun:test';
import { secrets } from '../test-aws';

const { printCommand } = await import('./print');

const schema = `# env-manager: demo | 2026-03-07T00:00:00Z

API_KEY= # {string}
CERT=secrets/cert.pem # {file}
EXTRA_CERT= # {file}
`;

async function print(payload: Parameters<typeof secrets.set>[1], environment?: string): Promise<string> {
  secrets.set('env-manager/demo', payload);
  const write = spyOn(process.stdout, 'write').mockImplementation(() => true);
  try {
    await printCommand({ project: 'demo', cwd: '/nonexistent' }, { environment });
    return write.mock.calls.map(call => String(call[0])).join('');
  } finally {
    write.mockRestore();
  }
}

describe('print', () => {
  test('prints a legacy single-environment secret as local, with file paths from values or schema defaults', async () => {
    const output = await print({
      schema,
      values: 'API_KEY=secret\nEXTRA_CERT=config/extra.pem',
      syncDate: '2026-03-07T00:00:00Z',
      files: { CERT: 'primary cert', EXTRA_CERT: 'secondary cert' },
    });
    expect(output).toBe(`project: demo

---- env: local ----

.env
# env-manager: demo

API_KEY= # {string}
CERT=secrets/cert.pem # {file}
EXTRA_CERT= # {file}

.env.local
# env-manager: demo
# env-manager env: local

API_KEY='secret' # {string}
EXTRA_CERT='config/extra.pem' # {file}

files
name: CERT
path: secrets/cert.pem
contents:
primary cert

name: EXTRA_CERT
path: config/extra.pem
contents:
secondary cert
`);
  });

  test('shows missing content and unknown paths when the stored files disagree with the schema', async () => {
    const output = await print({
      schema,
      values: 'API_KEY=secret',
      syncDate: '2026-03-07T00:00:00Z',
      files: { EXTRA_CERT: 'secondary cert', ORPHAN_FILE: 'orphan content' },
    });
    expect(output).toContain('name: CERT\npath: secrets/cert.pem\ncontents:\n(missing stored content)');
    expect(output).toContain('name: EXTRA_CERT\npath: (path missing)\ncontents:\nsecondary cert');
    expect(output).toContain('name: ORPHAN_FILE\npath: (unknown path)\ncontents:\norphan content');
  });

  test('prints every environment, or only the selected one', async () => {
    const payload = {
      schema,
      environments: {
        prod: { values: 'API_KEY=prod', syncDate: '2026-03-08T00:00:00Z' },
        local: { values: 'API_KEY=local', syncDate: '2026-03-07T00:00:00Z' },
      },
    };
    const all = await print(payload);
    expect(all.indexOf('---- env: local ----')).toBeLessThan(all.indexOf('---- env: prod ----'));
    expect(all).toContain("API_KEY='prod' # {string}");
    const prod = await print(payload, 'prod');
    expect(prod).toContain("API_KEY='prod' # {string}");
    expect(prod).not.toContain('---- env: local ----');
    await expect(print(payload, 'staging')).rejects.toThrow('Environment "staging" not found for project "demo". Available: local, prod');
  });
});
