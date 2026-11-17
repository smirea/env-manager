import { EnvManagerError } from '../errors';
import { validateEnvironmentName } from '../metadata';
import { parseEnvFile, parseEnvValues, schemaValue } from '../parser';
import type { CommandContext } from '../project';
import { requireEnvironment, requireProject } from '../store';

export interface SyncGithubOptions {
  only?: string[];
  repo?: string;
  dryRun?: boolean;
}

function gh(args: string[], stdin?: string): string {
  let result;
  try {
    result = Bun.spawnSync(['gh', ...args], {
      env: process.env,
      stdin: stdin === undefined ? 'ignore' : new TextEncoder().encode(stdin),
    });
  } catch {
    throw new EnvManagerError('GitHub CLI not found. Install it (brew install gh) and run gh auth login.');
  }
  if (result.exitCode !== 0) {
    throw new EnvManagerError(`gh ${args.slice(0, 2).join(' ')} failed: ${result.stderr.toString().trim() || `exit ${result.exitCode}`}`);
  }
  return result.stdout.toString().trim();
}

// GitHub refuses these names, so a schema that holds one, such as a GITHUB_TOKEN the app reads, cannot sync it.
function refusedByGithub(name: string): boolean {
  return /^GITHUB_/i.test(name);
}

export async function syncGithubCommand(ctx: CommandContext, environment: string, options: SyncGithubOptions = {}): Promise<void> {
  validateEnvironmentName(environment);
  const repo = options.repo ?? gh(['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']);
  const secret = await requireProject(ctx.project);
  const payload = requireEnvironment(secret, ctx.project, environment);
  const { schema } = parseEnvFile(secret.schema);
  const values = parseEnvValues(payload.values);

  const stored = new Map<string, string>();
  for (const entry of schema) {
    const value = entry.type === 'file' ? payload.files?.[entry.name] : schemaValue(entry, values);
    if (value) stored.set(entry.name, value);
  }

  const only = options.only?.flatMap(names => names.split(',')).map(name => name.trim()).filter(Boolean);
  const problems: string[] = [];
  for (const name of only ?? []) {
    if (!schema.some(entry => entry.name === name)) problems.push(`${name} is not in the ${ctx.project} schema`);
    else if (!stored.has(name)) problems.push(`${name} has no value in ${ctx.project}/${environment}`);
    else if (refusedByGithub(name)) problems.push(`${name} cannot be a GitHub secret: GitHub reserves names that start with GITHUB_`);
  }
  if (problems.length) throw new EnvManagerError(`Cannot sync to GitHub:\n${problems.map(problem => `  ${problem}`).join('\n')}`);

  const names = only ?? schema.map(entry => entry.name).filter(name => stored.has(name) && !refusedByGithub(name));
  if (!only) {
    const unset = schema.map(entry => entry.name).filter(name => !stored.has(name));
    const refused = [...stored.keys()].filter(refusedByGithub);
    if (unset.length) console.log(`Skipped, no value in ${environment}: ${unset.join(', ')}`);
    if (refused.length) console.log(`Skipped, GitHub reserves the name: ${refused.join(', ')}`);
  }
  if (!names.length) throw new EnvManagerError(`${ctx.project}/${environment} holds no value to sync.`);

  if (options.dryRun) {
    console.log(`Would set ${names.length} GitHub secret${names.length === 1 ? '' : 's'} in ${repo} from ${ctx.project}/${environment}: ${names.join(', ')}`);
    return;
  }
  for (const name of names) gh(['secret', 'set', name, '--repo', repo], stored.get(name)!);
  console.log(`Set ${names.length} GitHub secret${names.length === 1 ? '' : 's'} in ${repo} from ${ctx.project}/${environment}: ${names.join(', ')}`);
}
