import { mock } from 'bun:test';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { SecretPayload } from './store';

// Git hooks export GIT_DIR/GIT_INDEX_FILE; inherited by the git calls in tests, they redirect
// `git init`/`git config` on temp repos into the repo running the hook.
for (const name of Object.keys(process.env)) {
  if (name.startsWith('GIT_')) delete process.env[name];
}

// Preloaded, so no test can reach AWS: every secret lives in this map.
export const secrets = new Map<string, SecretPayload>();
export const puts: SecretPayload[] = [];

mock.module('./aws', () => ({
  checkAwsCredentials: async () => {},
  createAwsAdapter: () => ({
    getSecret: async (name: string) => structuredClone(secrets.get(name) ?? null),
    putSecret: async (name: string, payload: SecretPayload) => {
      puts.push(payload);
      secrets.set(name, structuredClone(payload));
    },
    deleteSecret: async (name: string) => secrets.delete(name),
    listSecrets: async (prefix: string) => [...secrets.keys()].filter(name => name.startsWith(prefix)),
  }),
}));

export async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), 'env-manager-test-')));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
