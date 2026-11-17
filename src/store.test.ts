import { describe, expect, test } from 'bun:test';
import { secrets } from './test-aws';

const { readProject, validateProjectName } = await import('./store');

describe('store', () => {
  test('a secret from before environments existed reads as the local environment', async () => {
    secrets.set('env-manager/legacy', {
      schema: '# env-manager: legacy | 2026-03-07T00:00:00Z\n\nCERT= # {file}\n',
      values: 'CERT=cert.pem',
      syncDate: '2026-03-07T00:00:00Z',
      files: { CERT: 'contents' },
    });
    try {
      expect(await readProject('legacy')).toEqual({
        schema: '# env-manager: legacy\n\nCERT= # {file}\n',
        environments: { local: { values: 'CERT=cert.pem', syncDate: '2026-03-07T00:00:00Z', files: { CERT: 'contents' } } },
      });
    } finally {
      secrets.delete('env-manager/legacy');
    }
  });

  test('a project cannot write to storage under the names that hold the global defaults', () => {
    for (const name of ['default', 'global']) {
      expect(() => validateProjectName(name, 'up', { reserved: true })).toThrow();
      expect(() => validateProjectName(name, 'print', { reserved: false })).not.toThrow();
    }
  });
});
