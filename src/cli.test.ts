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
  const result = Bun.spawnSync(['git', '-C', cwd, ...args], { env: process.env });
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
      expect(original).toContain('# env-manager format: swift');
      await writeFile(join(cwd, '.env'), `${original}\nAPI_KEY= # {string}\n`);
      await initRepo(cwd);
      const head = git(cwd, 'rev-parse', 'HEAD');
      expect(run(cwd, cli, 'init', '--local', '--values-format', 'ts', '--values-path', '.env.local').code).toBe(0);
      const updated = await readFile(join(cwd, '.env'), 'utf8');
      expect(updated).toContain('API_KEY= # {string}');
      expect(updated).toContain('# env-manager format: ts');
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
      const normal = run(cwd, cli, 'gen', 'normal.ts', '--no-local');
      expect(normal.code).toBe(0);
      expect(git(cwd, 'log', '-1', '--format=%s').trim()).toBe('chore: env manager update');
    });
  });
});

describe('persistent local and target workflows', () => {
  test('moves a tracked env directive into the values file unless one is already set', async () => {
    await withLocalCli(async (cwd, cli) => {
      await writeFile(join(cwd, 'package.json'), '{}\n');
      const schema = '# env-manager: demo\n# env-manager env: staging\nPORT=3000 # {int}\n';
      await writeFile(join(cwd, '.env'), schema);
      await writeFile(join(cwd, '.gitignore'), '.env.local\n');
      await initRepo(cwd);
      expect(run(cwd, cli, 'check').stderr).toContain('belongs in .env.local');

      expect(run(cwd, cli, 'gen').code).toBe(0);
      expect(git(cwd, 'show', 'HEAD:.env')).not.toContain('env-manager env:');
      expect(git(cwd, 'status', '--porcelain', '--untracked-files=no')).toBe('');
      const local = await readFile(join(cwd, '.env.local'), 'utf8');
      expect(local.split('\n')[0]).toBe('# env-manager: demo | v1');
      expect(local).toContain('# env-manager env: staging\n');

      await writeFile(join(cwd, '.env'), schema.replace('staging', 'prod'));
      expect(run(cwd, cli, 'format', '--local').code).toBe(0);
      expect(await readFile(join(cwd, '.env'), 'utf8')).not.toContain('env-manager env:');
      expect(await readFile(join(cwd, '.env.local'), 'utf8')).toBe(local);
    });
  });

  test('persists init local mode, blocks storage commands before credentials, and respects explicit overrides', async () => {
    await withLocalCli(async (cwd, cli) => {
      await writeFile(join(cwd, 'package.json'), '{}\n');
      expect(run(cwd, cli, 'init', '--local').code).toBe(0);
      expect(await readFile(join(cwd, '.env'), 'utf8')).toContain('# env-manager local: true');
      await initRepo(cwd);
      const head = git(cwd, 'rev-parse', 'HEAD');
      const index = git(cwd, 'write-tree');
      for (const command of [['up'], ['down'], ['rm'], ['print'], ['list'], ['env', 'list'], ['env', 'rm', 'staging'], ['global', 'get'], ['new-key', 'OPENROUTER_API_KEY']]) {
        const result = run(cwd, cli, ...command);
        expect(result.stderr).toContain('disabled in local mode');
        expect(result.stderr).not.toContain('AWS region');
      }
      expect(run(cwd, cli, 'new-key', '--list').code).toBe(0);
      const override = run(cwd, cli, 'list', '--no-local');
      expect(override.stderr).not.toContain('disabled in local mode');
      expect(override.code).not.toBe(0);
      expect(run(cwd, cli, 'set', 'format', 'swift').code).toBe(0);
      expect(run(cwd, cli, 'check').code).toBe(0);
      expect(run(cwd, cli, 'format').code).toBe(0);
      expect(git(cwd, 'rev-parse', 'HEAD')).toBe(head);
      expect(git(cwd, 'write-tree')).toBe(index);
    });
  });

  test('generates selected target subsets, leaves root values unchanged, and resolves commands from children', async () => {
    await withLocalCli(async (cwd, cli) => {
      await writeFile(join(cwd, '.env'), `# env-manager: mono
# env-manager local:true
# env-manager target: ios format=swift
# env-manager target: client format=ts path=.env
# env-manager target: server format=ts path=config/.env.local
# env-manager targets: *
API_URL=https://example.com # {url}
# env-manager targets: client
CLIENT_KEY= # {string}
# env-manager targets: server
SERVER_KEY= # {string}
`);
      const source = '# env-manager env: staging\nCLIENT_KEY=client-secret\nSERVER_KEY=server-secret\n';
      await writeFile(join(cwd, '.env.local'), source);
      git(cwd, 'init');
      expect(run(cwd, cli, 'gen', '--target', 'client').code).toBe(0);
      expect(await Bun.file(join(cwd, 'server/src/env.ts')).exists()).toBe(false);
      expect(await Bun.file(join(cwd, 'ios/Config/LocalSecrets.xcconfig')).exists()).toBe(false);
      expect(run(cwd, cli, 'generate').code).toBe(0);
      const client = await readFile(join(cwd, 'client/.env'), 'utf8');
      expect(client).toContain('CLIENT_KEY=');
      expect(client).not.toContain('SERVER_KEY=');
      expect(client).toContain('# env-manager target: client');
      expect(client).toContain('# env-manager root: ..');
      expect(client).toContain('# env-manager env: staging');
      const server = await readFile(join(cwd, 'server/config/.env.local'), 'utf8');
      expect(server).toContain('SERVER_KEY=');
      expect(server).not.toContain('CLIENT_KEY=');
      const swift = await readFile(join(cwd, 'ios/Config/LocalSecrets.xcconfig'), 'utf8');
      expect(swift).toContain('API_URL = https:/$()/example.com');
      expect(swift).not.toContain('_KEY');
      const reader = await readFile(join(cwd, 'client/src/env.ts'), 'utf8');
      expect(reader).not.toContain('client-secret');
      expect(reader).not.toContain('server-secret');
      expect(reader).toContain('// env-manager target: client');
      const root = await readFile(join(cwd, '.env.local'), 'utf8');
      expect(root.split('\n').filter(line => !line.startsWith('# env-manager: ') && !line.startsWith('# env-manager output: ')).join('\n')).toBe(source);
      expect(root).toContain('# env-manager output: client/.env v1 ');
      expect(run(join(cwd, 'client'), cli, 'check').code).toBe(0);
      const rootSchema = await readFile(join(cwd, '.env'), 'utf8');
      await writeFile(join(cwd, '.env'), rootSchema.replace('ios format=swift', 'ios format=swift path=config/.env'));
      expect(run(cwd, cli, 'gen', '--target', 'ios').code).toBe(0);
      expect(run(join(cwd, 'ios/config'), cli, 'check').code).toBe(0);
      expect(run(join(cwd, 'server'), cli, 'env', 'set', 'production').code).toBe(0);
      expect(await readFile(join(cwd, '.env.local'), 'utf8')).toContain('# env-manager env: production');
      expect(run(join(cwd, 'client'), cli, 'gen', '--target', 'client').code).toBe(0);
      expect(await readFile(join(cwd, 'client/.env'), 'utf8')).toContain('# env-manager env: production');
    });
  });

  test('preflight prevents partial outputs on collisions, ownership conflicts, and symlink escapes', async () => {
    await withLocalCli(async (cwd, cli) => {
      const schema = `# env-manager: mono
# env-manager local:true
# env-manager target: client format=ts
# env-manager target: server format=ts path=src/env.ts
# env-manager targets: *
PORT=3000 # {int}
`;
      await writeFile(join(cwd, '.env'), schema);
      const collision = run(cwd, cli, 'gen');
      expect(collision.stderr).toContain('Output collision');
      expect(await Bun.file(join(cwd, '.env.local')).exists()).toBe(false);
      expect(await Bun.file(join(cwd, 'client/src/env.ts')).exists()).toBe(false);
      const valid = schema.replace(' path=src/env.ts', '');
      await writeFile(join(cwd, '.env'), valid);
      await mkdir(join(cwd, 'server'), { recursive: true });
      await writeFile(join(cwd, 'server/.env.local'), '# env-manager: another-project\n');
      expect(run(cwd, cli, 'gen').stderr).toContain('belongs to another');
      expect(await Bun.file(join(cwd, 'client/src/env.ts')).exists()).toBe(false);
      await rm(join(cwd, 'server'), { recursive: true });
      const outside = join(cwd, '../outside');
      await mkdir(outside);
      await symlink(outside, join(cwd, 'server'));
      expect(run(cwd, cli, 'check').stderr).toContain('escapes server');
      expect(run(cwd, cli, 'gen').code).not.toBe(0);
      expect(await Bun.file(join(cwd, 'client/src/env.ts')).exists()).toBe(false);
      await rm(join(cwd, 'server'));
      await mkdir(join(cwd, 'server'));
      await writeFile(join(cwd, 'server/src'), 'not a directory');
      const parentFile = run(cwd, cli, 'gen');
      expect(parentFile.stderr).toContain('.env:4: Cannot use output');
      expect(await Bun.file(join(cwd, 'client/src/env.ts')).exists()).toBe(false);
    });
  });
});

describe('project lookup', () => {
  test('ignores non-env-manager files and never searches past the repository root or outside git', async () => {
    await withLocalCli(async (cwd, cli) => {
      await mkdir(join(cwd, 'sub'));
      await writeFile(join(cwd, '.env'), 'export PATH=/usr/bin\n');
      git(cwd, 'init');
      const unmanaged = run(join(cwd, 'sub'), cli, 'check');
      expect(unmanaged.code).toBe(3);
      expect(unmanaged.stderr).toContain('or its parents up to the repository root');
      expect(unmanaged.stderr).toContain('/project/.env has no "# env-manager: <project>" header');
      expect(await readFile(join(cwd, '.env'), 'utf8')).toBe('export PATH=/usr/bin\n');

      await rm(join(cwd, '.git'), { recursive: true });
      await writeFile(join(cwd, '.env'), '# env-manager: demo\n# env-manager local:true\nPORT=3000 # {int}\n');
      const outsideGit = run(join(cwd, 'sub'), cli, 'check');
      expect(outsideGit.code).toBe(3);
      expect(outsideGit.stderr).toContain('outside a git repository only the current directory is searched');
    });
  });

  test('uses the managed root above an unmanaged .env and warns about it', async () => {
    await withLocalCli(async (cwd, cli) => {
      await writeFile(join(cwd, '.env'), '# env-manager: demo\n# env-manager local:true\nPORT=3000 # {int}\n');
      await mkdir(join(cwd, 'web'));
      await writeFile(join(cwd, 'web/.env'), 'NEXT_PUBLIC_X=1\n');
      await writeFile(join(cwd, 'package.json'), '{}\n');
      git(cwd, 'init');
      const result = run(join(cwd, 'web'), cli, 'check');
      expect(result.code).toBe(0);
      expect(result.stderr).toContain('Warning: ignoring ');
      expect(result.stderr).toContain('/web/.env: it has no env-manager metadata.');
    });
  });

  test('project-name and clone commands refuse to guess before touching credentials', async () => {
    await withLocalCli(async (cwd, cli) => {
      const rmResult = run(cwd, cli, 'rm');
      expect(rmResult.code).toBe(3);
      expect(rmResult.stderr).toContain('Pass --project <name>');
      await writeFile(join(cwd, '.env'), 'FOO=bar\n');
      const down = run(cwd, cli, 'down');
      expect(down.code).toBe(3);
      expect(down.stderr).toContain('down would overwrite');
      expect(await readFile(join(cwd, '.env'), 'utf8')).toBe('FOO=bar\n');
    });
  });

  test('init refuses to nest under a managed root', async () => {
    await withLocalCli(async (cwd, cli) => {
      await writeFile(join(cwd, '.env'), '# env-manager: mono\n# env-manager local:true\n');
      await mkdir(join(cwd, 'apps/web'), { recursive: true });
      git(cwd, 'init');
      const result = run(join(cwd, 'apps/web'), cli, 'init', '--local');
      expect(result.code).toBe(1);
      expect(result.stderr).toContain('already manages it');
      expect(result.stderr).toContain('# env-manager target: apps/web format=ts');
      expect(await Bun.file(join(cwd, 'apps/web/.env')).exists()).toBe(false);
    });
  });

  test('init creates below the repository root with a warning and adopts an unmanaged .env', async () => {
    await withLocalCli(async (cwd, cli) => {
      await writeFile(join(cwd, '.env'), 'export PATH=/usr/bin\n');
      await mkdir(join(cwd, 'tool'));
      await writeFile(join(cwd, 'tool/.env'), 'PORT=3000\n');
      await writeFile(join(cwd, 'tool/package.json'), '{}\n');
      git(cwd, 'init');
      const result = run(join(cwd, 'tool'), cli, 'init', '--local');
      expect(result.code).toBe(0);
      expect(result.stderr).toContain('below the repository root');
      expect(result.stdout).toContain('Adopted existing .env as project "tool"');
      expect(await readFile(join(cwd, 'tool/.env'), 'utf8')).toBe('# env-manager: tool\n# env-manager local: true\n\nPORT=3000\n');
      expect(await readFile(join(cwd, '.env'), 'utf8')).toBe('export PATH=/usr/bin\n');
      expect(run(join(cwd, 'tool'), cli, 'info').code).toBe(0);
    });
  });
});

describe('guards', () => {
  test('format and env-directive migration refuse invalid setups without writing', async () => {
    await withLocalCli(async (cwd, cli) => {
      const legacy = '# env-manager: demo\n# env-manager local:true\nPORT=3000 # {int}\n';
      await writeFile(join(cwd, '.env'), legacy);
      const format = run(cwd, cli, 'format');
      expect(format.code).toBe(1);
      expect(format.stderr).toContain('Values format is not configured');
      expect(await readFile(join(cwd, '.env'), 'utf8')).toBe(legacy);

      await writeFile(join(cwd, '.env'), `${legacy}# env-manager env:\n`);
      expect(run(cwd, cli, 'set', 'local', 'true').stderr).toContain('Invalid environment ""');
    });
  });

  test('reserved names block storage use but not inspection or local work', async () => {
    await withLocalCli(async (cwd, cli) => {
      await writeFile(join(cwd, 'package.json'), '{}\n');
      await writeFile(join(cwd, '.env'), '# env-manager: global\n# env-manager local:true\nPORT=3000 # {int}\n');
      expect(run(cwd, cli, 'check').code).toBe(0);
      expect(run(cwd, cli, 'gen').code).toBe(0);
      expect(run(cwd, cli, 'up', '--no-local').stderr).toContain('"global" is a reserved project name and cannot be used with up');
      const print = run(cwd, cli, 'print', 'default', '--no-local');
      expect(print.stderr).not.toContain('reserved');
      expect(print.stderr).toContain('AWS region not configured');
    });
  });

  test('info reports a missing header with exit 3 even when the directory name is not a valid project name', async () => {
    await withLocalCli(async (cwd, cli) => {
      const dir = join(cwd, 'My App');
      await mkdir(dir);
      await writeFile(join(dir, 'package.json'), '{}\n');
      await writeFile(join(dir, '.env'), '# env-manager local: true\nPORT=3000 # {int}\n');
      const info = run(dir, cli, 'info');
      expect(info.code).toBe(3);
      expect(info.stderr).toContain('has no "# env-manager: <project>" header');
    });
  });
});

describe('info', () => {
  test('exits 3 without a setup and describes targets read-only', async () => {
    await withLocalCli(async (cwd, cli) => {
      const missing = run(cwd, cli, 'info');
      expect(missing.code).toBe(3);
      expect(missing.stderr).toContain('No env-manager setup');

      await writeFile(join(cwd, '.env'), [
        '# env-manager: demo',
        '# env-manager target: ios format=swift',
        '# env-manager target: web format=ts',
        '# env-manager targets: ios,web',
        'API_URL=https://example.com # {url}',
        '# env-manager targets: web',
        'PORT= # {optional int}',
        '',
      ].join('\n'));
      await writeFile(join(cwd, '.env.local'), '# env-manager env: prod\n# env-manager values env: prod\nAPI_URL=https://prod.example.com\n');
      await writeFile(join(cwd, '.env.override'), 'API_URL=http://127.0.0.1:1\n');
      await initRepo(cwd);

      const result = run(cwd, cli, 'info', '--local');
      expect(result.code).toBe(0);
      const info = JSON.parse(result.stdout);
      expect(info.environment).toEqual({ current: 'prod', valuesLoadedFrom: 'prod' });
      expect(info.environments).toBe(null);
      expect(info.override.variables).toEqual(['API_URL']);
      expect(info.targets.map((t: { name: string; format: string; variables: string[] }) => [t.name, t.format, t.variables])).toEqual([
        ['ios', 'swift', ['API_URL']],
        ['web', 'ts', ['API_URL', 'PORT']],
      ]);
      expect(info.variables).toEqual([
        { name: 'API_URL', type: 'url', optional: false, default: 'https://example.com', targets: ['ios', 'web'] },
        { name: 'PORT', type: 'int', optional: true, default: null, targets: ['web'] },
      ]);
      expect(git(cwd, 'status', '--porcelain')).toBe('');
    });
  });
});
