import { describe, expect, spyOn, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { CommandContext, EnvVarSchema } from './types';
import {
  generateSwiftValuesContent,
  parseSwiftValues,
  parseValuesConfig,
  resolveValuesConfig,
  upsertValuesConfigField,
  writeValuesForConfig,
} from './values-config';

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'env-manager-values-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const schema: EnvVarSchema[] = [
  {
    name: 'GIPHY_API_KEY',
    type: 'string',
    optional: false,
    validators: [],
    defaultValue: null,
    lineNumber: 1,
  },
  {
    name: 'GEMINI_API_KEY',
    type: 'string',
    optional: false,
    validators: [],
    defaultValue: null,
    lineNumber: 2,
  },
];

describe('values config', () => {
  test('parses explicit values format and path metadata', () => {
    const config = parseValuesConfig(`# env-manager: demo | 2026-01-01T00:00:00Z
# env-manager values.format: swift
# env-manager values.path: Config/LocalSecrets.xcconfig
`);

    expect(config).toEqual({
      format: 'swift',
      path: 'Config/LocalSecrets.xcconfig',
    });
  });

  test('falls back to ts values when package.json exists', async () => {
    await withTempDir(async (dir) => {
      await writeFile(path.join(dir, 'package.json'), '{}\n');

      await expect(
        resolveValuesConfig(
          { project: 'demo', cwd: dir },
          '# env-manager: demo | 2026-01-01T00:00:00Z\n'
        )
      ).resolves.toEqual({
        format: 'ts',
        path: '.env.local',
      });
    });
  });

  test('shows setup guidance without config or package.json fallback', async () => {
    await withTempDir(async (dir) => {
      const warn = spyOn(console, 'warn').mockImplementation(() => {});
      try {
        await expect(
          resolveValuesConfig(
            { project: 'demo', cwd: dir },
            '# env-manager: demo | 2026-01-01T00:00:00Z\n'
          )
        ).rejects.toThrow('Values output is not configured');
        expect(warn).toHaveBeenCalledWith(
          [
            'Warning: package.json not found, so env-manager could not infer the values format.',
            'Configure Swift values, for example:',
            '  env-manager set values.format swift && env-manager set values.path Config/LocalSecrets.xcconfig',
          ].join('\n')
        );
      } finally {
        warn.mockRestore();
      }
    });
  });

  test('upserts values metadata after the env-manager header', () => {
    const content = upsertValuesConfigField(
      '# env-manager: demo | 2026-01-01T00:00:00Z\n\nFOO= # {string}\n',
      'values.format',
      'swift'
    );

    expect(content.split('\n').slice(0, 3)).toEqual([
      '# env-manager: demo | 2026-01-01T00:00:00Z',
      '# env-manager values.format: swift',
      '',
    ]);
  });

  test('renders and parses swift xcconfig values', () => {
    const content = generateSwiftValuesContent(schema, {
      GIPHY_API_KEY: 'giphy-secret',
      GEMINI_API_KEY: 'gemini-secret',
      EXTRA: 'kept',
    });

    expect(content).toBe(`GIPHY_API_KEY = giphy-secret
GEMINI_API_KEY = gemini-secret
EXTRA = kept
`);
    expect(parseSwiftValues(`// local secrets
${content}`)).toEqual({
      GIPHY_API_KEY: 'giphy-secret',
      GEMINI_API_KEY: 'gemini-secret',
      EXTRA: 'kept',
    });
  });

  test('writes ts and swift values to their configured locations', async () => {
    await withTempDir(async (dir) => {
      const ctx: CommandContext = { project: 'demo', cwd: dir };

      await writeValuesForConfig(
        ctx,
        { format: 'ts', path: '.env.local' },
        schema,
        { GIPHY_API_KEY: 'giphy-secret' },
        'staging',
        { project: 'demo', syncDate: '2026-01-01T00:00:00Z' }
      );
      await writeValuesForConfig(
        ctx,
        { format: 'swift', path: 'Config/LocalSecrets.xcconfig' },
        schema,
        { GIPHY_API_KEY: 'giphy-secret' },
        'staging',
        { project: 'demo', syncDate: '2026-01-01T00:00:00Z' }
      );

      expect(await readFile(path.join(dir, '.env.local'), 'utf8')).toContain(
        '# env-manager env: staging'
      );
      expect(
        await readFile(
          path.join(dir, 'Config/LocalSecrets.xcconfig'),
          'utf8'
        )
      ).toBe('GIPHY_API_KEY = giphy-secret\n');
    });
  });
});
