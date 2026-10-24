import { join } from 'node:path';
import { schemaForTarget } from '../config';
import { checkAwsCredentials, createAwsAdapter, secretName } from '../aws';
import { findValuesEnvironment, resolveEnvironment } from '../environment';
import { parseEnvValues } from '../parser';
import { listProjectEnvironments } from '../project-secret';
import type { CommandContext } from '../types';
import { NotInitializedError } from '../types';
import { OVERRIDE_FILE, planGeneration } from './generate';

export interface ProjectInfo {
  initialized: true;
  root: string;
  project: string;
  local: boolean;
  mode: 'targets' | 'single';
  environment: { current: string; valuesLoadedFrom: string | null };
  environments: string[] | null;
  environmentsError: string | null;
  values: { path: string; format: 'ts' | 'swift'; exists: boolean };
  override: { path: string; variables: string[] } | null;
  outputs: { target: string | null; kind: 'values' | 'reader'; format: 'ts' | 'swift'; path: string; exists: boolean }[];
  targets: { name: string; directory: string; format: 'ts' | 'swift'; values: string; reader: string | null; variables: string[] }[];
  variables: { name: string; type: string; optional: boolean; default: string | null; targets: string[] | null }[];
}

export async function collectInfo(ctx: CommandContext, options: { local: boolean }): Promise<ProjectInfo> {
  const envFile = Bun.file(join(ctx.cwd, '.env'));
  const content = (await envFile.exists()) ? await envFile.text() : null;
  if (content === null) throw new NotInitializedError(`No env-manager setup: ${ctx.cwd}/.env does not exist. Run env-manager init.`);
  const plan = await planGeneration(ctx, content);
  if (!plan.config.header) throw new NotInitializedError(`No env-manager setup: ${ctx.cwd}/.env has no "# env-manager: <project>" header. Run env-manager init.`);

  const { config, valuesConfig } = plan;
  const valuesPath = valuesConfig.format === 'ts' ? valuesConfig.path : undefined;
  const overrideFile = Bun.file(join(ctx.cwd, OVERRIDE_FILE));
  const outputs = await Promise.all(plan.outputs.map(async output => ({
    target: output.target ?? null,
    kind: output.kind,
    format: output.format,
    path: output.path,
    exists: await Bun.file(output.path).exists(),
  })));

  let environments: string[] | null = null;
  let environmentsError: string | null = null;
  if (options.local) {
    environmentsError = 'Local mode: stored environments are not read. Pass --no-local to read them.';
  } else {
    try {
      await checkAwsCredentials();
      const secret = await createAwsAdapter().getSecret(secretName(ctx.project));
      environments = secret ? listProjectEnvironments(secret) : [];
    } catch (error) {
      environmentsError = error instanceof Error ? error.message : String(error);
    }
  }

  return {
    initialized: true,
    root: ctx.cwd,
    project: ctx.project,
    local: options.local,
    mode: config.targets.length ? 'targets' : 'single',
    environment: {
      current: await resolveEnvironment(ctx.cwd, { valuesPath }),
      valuesLoadedFrom: await findValuesEnvironment(ctx.cwd, { valuesPath }),
    },
    environments,
    environmentsError,
    values: {
      path: join(ctx.cwd, valuesConfig.path),
      format: valuesConfig.format,
      exists: outputs.some(o => o.path === join(ctx.cwd, valuesConfig.path) && o.exists),
    },
    override: (await overrideFile.exists())
      ? { path: join(ctx.cwd, OVERRIDE_FILE), variables: Object.keys(parseEnvValues(await overrideFile.text())) }
      : null,
    outputs,
    targets: config.targets.map(target => ({
      name: target.name,
      directory: join(ctx.cwd, target.name),
      format: target.format,
      values: join(ctx.cwd, target.name, target.path),
      reader: target.generate ? join(ctx.cwd, target.name, target.generate) : null,
      variables: schemaForTarget(config, target.name).map(s => s.name),
    })),
    variables: config.schema.map(entry => ({
      name: entry.name,
      type: entry.type,
      optional: entry.optional,
      default: entry.defaultValue || null,
      targets: config.targets.length ? config.scopes.get(entry.name) ?? [] : null,
    })),
  };
}

export async function infoCommand(ctx: CommandContext, options: { local: boolean }): Promise<void> {
  console.log(JSON.stringify(await collectInfo(ctx, options), null, 2));
}
