import { anthropicKey } from "./anthropic";
import { openRouterKey } from "./openrouter";

export interface KeyDefinition {
  envName: string;
  description: string;
  schemaType: string;
  validate(key: string): boolean;
  resolve(projectName: string, options?: KeyResolveOptions): Promise<string>;
}

export interface KeyResolveOptions {
  name?: string;
  credit?: number;
  expiration?: string;
}

const KEYS: Record<string, KeyDefinition> = {
  ANTHROPIC_API_KEY: anthropicKey,
  OPENROUTER_API_KEY: openRouterKey,
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
