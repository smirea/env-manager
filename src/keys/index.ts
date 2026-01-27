import { anthropicKey } from "./anthropic";

export interface KeyDefinition {
  envName: string;
  description: string;
  schemaType: string;
  validate(key: string): boolean;
  resolve(projectName: string): Promise<string>;
}

const KEYS: Record<string, KeyDefinition> = {
  ANTHROPIC_API_KEY: anthropicKey,
};

export function getKey(name: string): KeyDefinition | undefined {
  return KEYS[name];
}

export function listKeys(): KeyDefinition[] {
  return Object.values(KEYS);
}

export function listKeyNames(): string[] {
  return Object.keys(KEYS);
}
