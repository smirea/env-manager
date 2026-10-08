import { describe, expect, test } from 'bun:test';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

async function withLocalCli(fn: (cwd: string, cli: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'env-manager-cli-'));
  const tool = join(dir, 'tool');
  const cwd = join(dir, 'project');
  try {
    await cp(resolve(import.meta.dir), join(tool, 'src'), { recursive: true });
    await writeFile(join(tool, 'package.json'), '{}\n');
    await symlink(resolve(import.meta.dir, '../node_modules'), join(tool, 'node_modules'));
    await mkdir(cwd);
    await fn(cwd, join(tool, 'src/cli.ts'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function run(cwd: string, cli: string, ...args: string[]) {
  const env = { ...process.env };
  for (const name of Object.keys(env)) {
    if (name.startsWith('AWS_')) delete env[name];
  }
  env.AWS_EC2_METADATA_DISABLED = 'true';
  const result = Bun.spawnSync([process.execPath, cli, ...args], { cwd, env });
  return {
    code: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

function git(cwd: string, ...args: string[]) {
  const result = Bun.spawnSync(['git', '-C', cwd, ...args]);
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  return result.stdout.toString();
}

async function initRepo(cwd: string) {
  git(cwd, 'init');
  git(cwd, 'config', 'user.email', 'test@example.com');
  git(cwd, 'config', 'user.name', 'Test');
  git(cwd, 'config', 'commit.gpgsign', 'false');
  git(cwd, 'config', 'core.hooksPath', '/dev/null');
  git(cwd, 'add', '.');
  git(cwd, 'commit', '-m', 'initial');
}

describe('local CLI workflow', () => {
  test('initializes without credentials and updates existing config without committing', async () => {
    await withLocalCli(async (cwd, cli) => {
      const options = ['--local', '--values-format', 'swift', '--values-path', 'Config/Secrets.xcconfig'];
      expect(run(cwd, cli, 'init', ...options).code).toBe(0);
      const original = await readFile(join(cwd, '.env'), 'utf8');
      expect(original).toContain('# env-manager values.format: swift');
      await writeFile(join(cwd, '.env'), `${original}\nAPI_KEY= # {string}\n`);
      await initRepo(cwd);
      const head = git(cwd, 'rev-parse', 'HEAD');
      expect(run(cwd, cli, 'init', '--local', '--values-format', 'ts', '--values-path', '.env.local').code).toBe(0);
      const updated = await readFile(join(cwd, '.env'), 'utf8');
      expect(updated).toContain('API_KEY= # {string}');
      expect(updated).toContain('# env-manager values.format: ts');
      expect(git(cwd, 'rev-parse', 'HEAD')).toBe(head);
      expect(git(cwd, 'diff', '--cached')).toBe('');
      expect(git(cwd, 'diff', '--name-only')).toBe('.env\n');
    });
  });

  test('generation aliases and local settings preserve commits and partial staging', async () => {
    await withLocalCli(async (cwd, cli) => {
      await writeFile(join(cwd, 'package.json'), '{}\n');
      expect(run(cwd, cli, 'init', '--local').code).toBe(0);
      const envPath = join(cwd, '.env');
      await writeFile(envPath, `${await readFile(envPath, 'utf8')}\nPORT=3000 # {int}\n`);
      await initRepo(cwd);
      const head = git(cwd, 'rev-parse', 'HEAD');
      for (const command of ['generate', 'gen', 'ts']) {
        const result = run(cwd, cli, command, `${command}.ts`, '--force', '--local');
        expect(result.code).toBe(0);
        expect(result.stderr.includes('deprecated')).toBe(command === 'ts');
        expect(await readFile(join(cwd, `${command}.ts`), 'utf8')).toContain('PORT: z.coerce.number().int(),');
      }
      git(cwd, 'add', '.env');
      const index = git(cwd, 'show', ':.env');
      expect(run(cwd, cli, 'set', 'values.format', 'ts', '--local').code).toBe(0);
      expect(run(cwd, cli, 'set', 'values.path', '.env.development', '--local').code).toBe(0);
      expect(run(cwd, cli, 'env', 'set', 'development', '--local').code).toBe(0);
      expect(await readFile(join(cwd, '.env.development'), 'utf8')).toContain('# env-manager env: development');
      expect(git(cwd, 'show', ':.env')).toBe(index);
      expect(git(cwd, 'rev-parse', 'HEAD')).toBe(head);
      expect(run(cwd, cli, 'up', '--local').code).not.toBe(0);

      git(cwd, 'reset', '--hard', 'HEAD');
      const normal = run(cwd, cli, 'gen', 'normal.ts');
      expect(normal.code).toBe(0);
      expect(git(cwd, 'log', '-1', '--format=%s').trim()).toBe('chore: env manager update');
    });
  });
});
