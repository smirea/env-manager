import { join } from 'node:path';
import { checkAwsCredentials } from '../aws';
import { schemaForTarget } from '../config';
import { NotInitializedError } from '../errors';
import { readText } from '../files';
import { OVERRIDE_FILE } from '../outputs';
import { parseEnvValues } from '../parser';
import { loadProject, type CommandContext } from '../project';
import { canonicalSchema, environmentNames, readProject } from '../store';
import { readSelection } from '../values';

export interface ProjectInfo {
  initialized: true;
  root: string;
  project: string;
  local: boolean;
  mode: 'targets' | 'single';
  environment: { current: string; valuesLoadedFrom: string | null };
  environments: string[] | null;
  environmentsError: string | null;
  storedSchema: 'in-sync' | 'differs' | 'missing' | null;
  values: { path: string; format: 'ts' | 'swift'; exists: boolean };
  override: { path: string; variables: string[] } | null;
  outputs: { target: string | null; kind: 'values' | 'reader'; format: 'ts' | 'swift'; path: string; exists: boolean }[];
  targets: { name: string; directory: string; format: 'ts' | 'swift'; values: string; reader: string | null; variables: string[] }[];
  variables: { name: string; type: string; optional: boolean; default: string | null; targets: string[] | null }[];
}

export async function collectInfo(ctx: CommandContext, options: { local: boolean }): Promise<ProjectInfo> {
  const project = await loadProject(ctx);
  const { config, values } = project;
  if (!config.project) throw new NotInitializedError(`No env-manager setup: ${project.envPath} has no "# env-manager: <project>" header. Run env-manager init.`);

  const outputs = await Promise.all(project.outputs.map(async output => ({
    target: output.target ?? null,
    kind: output.kind,
    format: output.format,
    path: output.path,
    exists: await Bun.file(output.path).exists(),
  })));

  let environments: string[] | null = null;
  let environmentsError: string | null = null;
  let storedSchema: ProjectInfo['storedSchema'] = null;
  if (options.local) {
    environmentsError = 'Local mode: stored environments are not read. Pass --no-local to read them.';
  } else {
    try {
      await checkAwsCredentials();
      const secret = await readProject(ctx.project);
      environments = secret ? environmentNames(secret) : [];
      // down replaces .env with the stored schema, so callers need to know when that would rewrite it.
      storedSchema = !secret ? 'missing' : secret.schema === canonicalSchema(project.content) ? 'in-sync' : 'differs';
    } catch (error) {
      environmentsError = error instanceof Error ? error.message : String(error);
    }
  }

  const selection = await readSelection(project.root, values);
  const valuesPath = join(project.root, values.path);
  const overridePath = join(project.root, OVERRIDE_FILE);
  const override = await readText(overridePath);
  return {
    initialized: true,
    root: project.root,
    project: project.name,
    local: options.local,
    mode: config.targets.length ? 'targets' : 'single',
    environment: { current: selection.environment, valuesLoadedFrom: selection.loadedFrom },
    environments,
    environmentsError,
    storedSchema,
    values: { path: valuesPath, format: values.format, exists: await Bun.file(valuesPath).exists() },
    override: override === null ? null : { path: overridePath, variables: Object.keys(parseEnvValues(override)) },
    outputs,
    targets: config.targets.map(target => ({
      name: target.name,
      directory: join(project.root, target.name),
      format: target.format,
      values: join(project.root, target.name, target.path),
      reader: target.generate ? join(project.root, target.name, target.generate) : null,
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
