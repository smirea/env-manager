import { claudeProvider } from "./claude";

export interface KeyProvider {
  name: string;
  defaultEnvName: string;
  schemaType: string;
  validateKey(key: string): boolean;
  resolveKey(projectName: string): Promise<string>;
}

const providers: Record<string, KeyProvider> = {
  claude: claudeProvider,
};

export function getProvider(name: string): KeyProvider | undefined {
  return providers[name];
}

export function listProviders(): string[] {
  return Object.keys(providers);
}
