import { expect, test } from 'bun:test';
import { dirname } from 'node:path';

test('the published tarball holds only the source, the manifest, the README, and the license', () => {
  const result = Bun.spawnSync(['npm', 'pack', '--dry-run', '--json'], { cwd: dirname(import.meta.dir) });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  // npm 12 keys the result by package name, and earlier versions return an array.
  const [{ files }] = Object.values(JSON.parse(result.stdout.toString())) as [{ files: { path: string }[] }];
  const paths = files.map(file => file.path);

  expect(paths.filter(path => !/^src\/.+\.ts$/.test(path)).toSorted()).toEqual(['LICENSE', 'README.md', 'package.json']);
  expect(paths.filter(path => path.endsWith('.test.ts') || path.startsWith('src/test-'))).toEqual([]);
  expect(paths).toContain('src/cli.ts');
});
