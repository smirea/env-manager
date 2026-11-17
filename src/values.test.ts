import { describe, expect, test } from 'bun:test';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseRootConfig } from './config';
import type { EnvVarSchema } from './parser';
import { withTempDir } from './test-setup';
import { readSelection, resolveValuesConfig, writeSelection, writeSourceValues } from './values';

const schema: EnvVarSchema[] = ['GIPHY_API_KEY', 'GEMINI_API_KEY'].map((name, index) => ({
  name, type: 'string', optional: false, validators: [], defaultValue: null, lineNumber: index + 1,
}));

describe('values config', () => {
  test('beside a package.json values are ts, and the ts values file also holds the environment selector', async () => {
    await withTempDir(async (dir) => {
      await writeFile(path.join(dir, 'package.json'), '{}\n');
      const config = parseRootConfig('# env-manager: demo\n# env-manager values.path: config/.env.values\n');
      expect(await resolveValuesConfig(dir, config)).toEqual({ format: 'ts', path: 'config/.env.values', selectorPath: 'config/.env.values' });
    });
  });

  test('swift values default to Config/LocalSecrets.xcconfig and keep the selector in .env.local', async () => {
    await withTempDir(async (dir) => {
      const config = parseRootConfig('# env-manager: demo\n# env-manager format: swift\n');
      expect(await resolveValuesConfig(dir, config)).toEqual({ format: 'swift', path: 'Config/LocalSecrets.xcconfig', selectorPath: '.env.local' });
    });
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

  test('a swift values file holds only values, and the selection stays in .env.local', async () => {
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
