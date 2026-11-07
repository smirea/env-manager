import { describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseRootConfig } from './config';
import type { EnvVarSchema } from './parser';
import { parseValues, readSelection, renderValues, resolveValuesConfig, writeSelection, writeSourceValues } from './values';

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'env-manager-values-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const schema: EnvVarSchema[] = ['GIPHY_API_KEY', 'GEMINI_API_KEY'].map((name, index) => ({
  name, type: 'string', optional: false, validators: [], defaultValue: null, lineNumber: index + 1,
}));

describe('values config', () => {
  test('infers ts values from package.json and keeps the selector in the values file', async () => {
    await withTempDir(async (dir) => {
      await writeFile(path.join(dir, 'package.json'), '{}\n');
      const config = parseRootConfig('# env-manager: demo\n# env-manager values.path: config/.env.values\n');
      expect(await resolveValuesConfig(dir, config)).toEqual({ format: 'ts', path: 'config/.env.values', selectorPath: 'config/.env.values' });
    });
  });

  test('swift values keep the selector in .env.local', async () => {
    await withTempDir(async (dir) => {
      const config = parseRootConfig('# env-manager: demo\n# env-manager format: swift\n');
      expect(await resolveValuesConfig(dir, config)).toEqual({ format: 'swift', path: 'Config/LocalSecrets.xcconfig', selectorPath: '.env.local' });
    });
  });

  test('without a format or package.json the format must be configured', async () => {
    await withTempDir(async (dir) => {
      await expect(resolveValuesConfig(dir, parseRootConfig('# env-manager: demo\n'))).rejects.toThrow('Values format is not configured');
    });
  });
});

describe('swift values', () => {
  test('render in schema order with extras last and parse back, ignoring comments', () => {
    const content = renderValues('swift', schema, { EXTRA: 'kept', GEMINI_API_KEY: 'gemini-secret', GIPHY_API_KEY: 'giphy-secret' });
    expect(content).toBe('GIPHY_API_KEY = giphy-secret\nGEMINI_API_KEY = gemini-secret\nEXTRA = kept\n');
    expect(parseValues('swift', `// local secrets\n${content}`)).toEqual({ GIPHY_API_KEY: 'giphy-secret', GEMINI_API_KEY: 'gemini-secret', EXTRA: 'kept' });
  });

  test('escape xcconfig comment delimiters in URLs and round-trip them', () => {
    const content = renderValues('swift', [], { API_URL: 'https://example.com', TOKEN: 'abc//def' });
    expect(content).toBe('API_URL = https:/$()/example.com\nTOKEN = abc/$()/def\n');
    expect(parseValues('swift', content)).toEqual({ API_URL: 'https://example.com', TOKEN: 'abc//def' });
  });
});

describe('writing values', () => {
  test('rewriting ts values keeps the selected environment and where the values came from', async () => {
    await withTempDir(async (dir) => {
      const config = { format: 'ts', path: '.env.local', selectorPath: '.env.local' } as const;
      await writeSelection(dir, config, 'staging', 'dev');
      await writeSourceValues(dir, 'demo', config, schema, { GIPHY_API_KEY: 'giphy-secret' });
      expect(await readFile(path.join(dir, '.env.local'), 'utf8')).toBe(
        "# env-manager: demo\n# env-manager env: staging\n# env-manager values env: dev\n\nGIPHY_API_KEY='giphy-secret' # {string}\n"
      );
      expect(await readSelection(dir, config)).toEqual({ recorded: 'staging', environment: 'staging', loadedFrom: 'dev' });
    });
  });

  test('swift values hold only values; the selection stays in .env.local', async () => {
    await withTempDir(async (dir) => {
      const config = { format: 'swift', path: 'Config/LocalSecrets.xcconfig', selectorPath: '.env.local' } as const;
      await writeSelection(dir, config, 'staging');
      await writeSourceValues(dir, 'demo', config, schema, { GIPHY_API_KEY: 'giphy-secret' });
      expect(await readFile(path.join(dir, 'Config/LocalSecrets.xcconfig'), 'utf8')).toBe('GIPHY_API_KEY = giphy-secret\n');
      expect(await readSelection(dir, config)).toEqual({ recorded: 'staging', environment: 'staging', loadedFrom: null });
    });
  });

  test('without a selection the environment is local', async () => {
    await withTempDir(async (dir) => {
      const config = { format: 'ts', path: '.env.local', selectorPath: '.env.local' } as const;
      expect(await readSelection(dir, config)).toEqual({ recorded: null, environment: 'local', loadedFrom: null });
    });
  });
});
