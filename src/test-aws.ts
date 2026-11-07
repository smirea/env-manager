import { mock } from 'bun:test';
import type { SecretPayload } from './aws';

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
