import { describe, expect, test } from 'bun:test';
import {
  mkdtemp,
  mkdir,
  realpath,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadEnvFromPaths, loadOwnEnvFromPaths, resolveOwnEnvPaths } from './env-loader';

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'env-manager-env-loader-'));
  try {
    return await fn(dir);
  } finally {
    await unlink(path.join(dir, 'entry-link.ts')).catch(() => undefined);
    await Bun.$`trash ${dir}`.quiet();
  }
}

describe('env loader', () => {
  test('loadOwnEnvFromPaths overrides preloaded env while keeping .env.local precedence', async () => {
    await withTempDir(async (dir) => {
      const packageRoot = path.join(dir, 'env-manager');
      await mkdir(packageRoot, { recursive: true });
      await writeFile(
        path.join(packageRoot, '.env'),
        'AWS_REGION=from-dot-env\nSHARED_KEY=from-dot-env\n'
      );
      await writeFile(
        path.join(packageRoot, '.env.local'),
        'AWS_REGION=from-dot-env-local\nAWS_ACCESS_KEY_ID=own-access-key\n'
      );

      const previousRegion = process.env.AWS_REGION;
      const previousSharedKey = process.env.SHARED_KEY;
      const previousAccessKey = process.env.AWS_ACCESS_KEY_ID;

      process.env.AWS_REGION = 'from-cwd';
      process.env.SHARED_KEY = 'from-cwd';
      process.env.AWS_ACCESS_KEY_ID = 'from-cwd';

      try {
        loadOwnEnvFromPaths([packageRoot]);

        expect(process.env.AWS_REGION).toBe('from-dot-env-local');
        expect(process.env.SHARED_KEY).toBe('from-dot-env');
        expect(process.env.AWS_ACCESS_KEY_ID).toBe('own-access-key');
      } finally {
        restoreEnvVar('AWS_REGION', previousRegion);
        restoreEnvVar('SHARED_KEY', previousSharedKey);
        restoreEnvVar('AWS_ACCESS_KEY_ID', previousAccessKey);
      }
    });
  });

  test('loadEnvFromPaths does not override existing process env', async () => {
    await withTempDir(async (dir) => {
      const packageRoot = path.join(dir, 'env-manager');
      await mkdir(packageRoot, { recursive: true });
      await writeFile(path.join(packageRoot, '.env'), 'AWS_REGION=from-dot-env\n');

      const previousRegion = process.env.AWS_REGION;
      process.env.AWS_REGION = 'preloaded';

      try {
        loadEnvFromPaths([packageRoot]);
        expect(process.env.AWS_REGION).toBe('preloaded');
      } finally {
        restoreEnvVar('AWS_REGION', previousRegion);
      }
    });
  });

  test('resolves env-manager package root from module path', async () => {
    await withTempDir(async (dir) => {
      const packageRoot = path.join(dir, 'env-manager');
      const sourceDir = path.join(packageRoot, 'src');
      const modulePath = path.join(sourceDir, 'cli.ts');

      await mkdir(sourceDir, { recursive: true });
      await writeFile(
        path.join(packageRoot, 'package.json'),
        JSON.stringify({ name: 'env-manager' })
      );
      await writeFile(modulePath, '');

      const realPackageRoot = await realpath(packageRoot);
      expect(resolveOwnEnvPaths(pathToFileURL(modulePath).href)).toEqual([
        realPackageRoot,
      ]);
    });
  });

  test('follows symlinked entrypoints back to the real package root', async () => {
    await withTempDir(async (dir) => {
      const packageRoot = path.join(dir, 'env-manager');
      const sourceDir = path.join(packageRoot, 'src');
      const modulePath = path.join(sourceDir, 'cli.ts');
      const symlinkPath = path.join(dir, 'entry-link.ts');

      await mkdir(sourceDir, { recursive: true });
      await writeFile(
        path.join(packageRoot, 'package.json'),
        JSON.stringify({ name: 'env-manager' })
      );
      await writeFile(modulePath, '');
      await symlink(modulePath, symlinkPath);

      const realPackageRoot = await realpath(packageRoot);
      expect(resolveOwnEnvPaths(pathToFileURL(symlinkPath).href)).toEqual([
        realPackageRoot,
      ]);
    });
  });
});

function restoreEnvVar(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}
