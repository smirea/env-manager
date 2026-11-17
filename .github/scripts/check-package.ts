import { $ } from 'bun';

// npm 12 keys the result by package name, and earlier versions return an array.
const [{ files }] = Object.values(await $`npm pack --dry-run --json`.quiet().json()) as [{ files: { path: string }[] }];
const paths = files.map(file => file.path);
const unexpected = paths.filter(path => !['LICENSE', 'README.md', 'package.json'].includes(path) && !/^src\/.+\.ts$/.test(path));
const tests = paths.filter(path => path.endsWith('.test.ts') || path.startsWith('src/test-'));

if (unexpected.length || tests.length || !paths.includes('src/cli.ts')) {
  console.error('The package must hold only the source, the manifest, the README and the license. It holds:');
  for (const path of paths.toSorted()) console.error(`  ${path}`);
  process.exit(1);
}
console.log(`The package holds ${paths.length} files: the source, the manifest, the README and the license.`);
