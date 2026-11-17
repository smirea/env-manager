import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { secrets } from '../test-aws';

const { syncGithubCommand } = await import('./sync');

const SCHEMA = [
  '# env-manager: demo',
  '',
  'API_URL=http://127.0.0.1:3000 # {url}',
  'API_TOKEN= # {string}',
  'SENTRY_DSN= # {optional string}',
  'GITHUB_TOKEN= # {optional string}',
  'SIGNING_KEY= # {optional file}',
  '',
].join('\n');

// Records every `gh secret set` as name, repo and the value it received on stdin.
const FAKE_GH = `#!/bin/sh
if [ "$1 $2" = "repo view" ]; then echo acme/from-gh; exit 0; fi
if [ "$1 $2" = "secret set" ]; then
  printf '%s\\t%s\\t' "$3" "$5" >> "$GH_LOG"
  cat >> "$GH_LOG"
  printf '\\n' >> "$GH_LOG"
  exit 0
fi
echo "unexpected gh $*" >&2
exit 1
`;

describe('sync github', () => {
  const ctx = { project: 'demo', cwd: '/' };
  const original = { path: process.env.PATH, log: process.env.GH_LOG };
  let dir: string;
  let printed: string[];
  let log: ReturnType<typeof spyOn>;

  const calls = async () => (await readFile(path.join(dir, 'gh.log'), 'utf8').catch(() => ''))
    .split('\n').filter(Boolean).map(line => line.split('\t'));

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'env-manager-sync-'));
    await writeFile(path.join(dir, 'gh'), FAKE_GH);
    await chmod(path.join(dir, 'gh'), 0o755);
    process.env.PATH = `${dir}:${original.path}`;
    process.env.GH_LOG = path.join(dir, 'gh.log');
    printed = [];
    log = spyOn(console, 'log').mockImplementation((...args: unknown[]) => { printed.push(args.join(' ')); });
    secrets.set('env-manager/demo', {
      schema: SCHEMA,
      environments: {
        prod: {
          values: "API_URL='https://demo.example'\nAPI_TOKEN='tok_live'\nGITHUB_TOKEN='ghp_app'\nSIGNING_KEY='certs/key.pem'\n",
          syncDate: '2026-01-01T00:00:00.000Z',
          files: { SIGNING_KEY: '-----BEGIN KEY-----\nabc\n-----END KEY-----' },
        },
      },
    });
  });

  afterEach(async () => {
    log.mockRestore();
    process.env.PATH = original.path;
    if (original.log === undefined) delete process.env.GH_LOG;
    else process.env.GH_LOG = original.log;
    secrets.delete('env-manager/demo');
    await rm(dir, { recursive: true, force: true });
  });

  test('sets every variable that has a value, sends file contents, and never prints a value', async () => {
    await syncGithubCommand(ctx, 'prod');
    expect(await calls()).toEqual([
      ['API_URL', 'acme/from-gh', 'https://demo.example'],
      ['API_TOKEN', 'acme/from-gh', 'tok_live'],
      ['SIGNING_KEY', 'acme/from-gh', '-----BEGIN KEY-----'],
      ['abc'],
      ['-----END KEY-----'],
    ]);
    expect(printed).toEqual([
      'Skipped, no value in prod: SENTRY_DSN',
      'Skipped, GitHub reserves the name: GITHUB_TOKEN',
      'Set 3 GitHub secrets in acme/from-gh from demo/prod: API_URL, API_TOKEN, SIGNING_KEY',
    ]);
  });

  test('--only narrows the sync to the named variables and --repo names the repository', async () => {
    await syncGithubCommand(ctx, 'prod', { only: ['API_TOKEN, API_URL'], repo: 'acme/other' });
    expect(await calls()).toEqual([
      ['API_TOKEN', 'acme/other', 'tok_live'],
      ['API_URL', 'acme/other', 'https://demo.example'],
    ]);
  });

  test('--only fails before setting anything when a name is unknown, unset, or reserved by GitHub', async () => {
    await expect(syncGithubCommand(ctx, 'prod', { only: ['API_TOKEN', 'NOPE', 'SENTRY_DSN', 'GITHUB_TOKEN'] })).rejects.toThrow(
      'Cannot sync to GitHub:\n  NOPE is not in the demo schema\n  SENTRY_DSN has no value in demo/prod\n  GITHUB_TOKEN cannot be a GitHub secret',
    );
    expect(await calls()).toEqual([]);
  });

  test('--dry-run names the secrets without setting them', async () => {
    await syncGithubCommand(ctx, 'prod', { dryRun: true });
    expect(await calls()).toEqual([]);
    expect(printed.at(-1)).toBe('Would set 3 GitHub secrets in acme/from-gh from demo/prod: API_URL, API_TOKEN, SIGNING_KEY');
  });

  test('an environment that is not stored fails by name', async () => {
    await expect(syncGithubCommand(ctx, 'staging')).rejects.toThrow('Environment "staging" not found for project "demo". Available: prod');
    expect(await calls()).toEqual([]);
  });
});
