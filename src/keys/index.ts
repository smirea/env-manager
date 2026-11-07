import { anthropicKey } from './anthropic';
import { openRouterKey } from './openrouter';

export interface KeyOptions {
  name?: string;
  credit?: number;
  unlimited?: boolean;
  expiration?: string;
}

export interface KeyDefinition {
  envName: string;
  description: string;
  schemaType: string;
  checkOptions(options: KeyOptions): void;
  validate(key: string): boolean;
  resolve(projectName: string, options: KeyOptions, assumeYes: boolean): Promise<string>;
}

export const KEYS: KeyDefinition[] = [anthropicKey, openRouterKey];
