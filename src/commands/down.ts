import { join, relative } from 'node:path';
import { writeFilesFromPayload } from '../file-sync';
import { readText, writeManagedFile } from '../files';
import { EnvManagerError } from '../errors';
import { readMetadata, validateEnvironmentName } from '../metadata';
import { materialize } from '../outputs';
import { envValuesEqual, parseEnvValues } from '../parser';
import { loadProject, type CommandContext, type Project } from '../project';
import { environmentNames, requireEnvironment, requireProject, type EnvironmentPayload } from '../store';
import { assertValid } from '../validator';
import { parseValues, readSelection, renderSourceValues, writeSelection } from '../values';

export async function pullEnvironment(project: Project, environment: string, payload: EnvironmentPayload): Promise<void> {
  const { schema } = project.config;
  const values = parseEnvValues(payload.values);
  assertValid(schema, values);

  await writeFilesFromPayload(schema, values, payload.files, project.root);
  await writeManagedFile(project.envPath, project.content);

  const valuesPath = join(project.root, project.values.path);
  const existing = await readText(valuesPath);
  const localVersion = existing === null ? null : readMetadata(existing).version;
  const remoteVersion = payload.outputs?.[relative(project.root, valuesPath)]?.version ?? 0;
  const { recorded } = await readSelection(project.root, project.values);
  const stale = localVersion === null
    || localVersion < remoteVersion
    || (project.values.format === 'ts' && recorded !== environment)
    || !envValuesEqual(parseValues(project.values.format, existing ?? ''), values);
  if (stale) {
    await writeManagedFile(valuesPath, renderSourceValues(project.name, project.values, schema, values, { environment, loadedFrom: environment }));
  }
  await writeSelection(project.root, project.values, environment, environment);
  await materialize(project, { remote: payload.outputs });
}

export async function downCommand(ctx: CommandContext, options: { environment?: string } = {}): Promise<void> {
  if (options.environment) validateEnvironmentName(options.environment);
  const secret = await requireProject(ctx.project);
  const project = await loadProject(ctx, secret.schema);
  const available = environmentNames(secret);
  const environment = options.environment
    ?? (await readSelection(project.root, project.values)).recorded
    ?? (available.length === 1 ? available[0] : null);
  if (!environment) {
    throw new EnvManagerError(
      `No environment selected for "${ctx.project}". Pass --env <name> or run "env-manager env set <name>". Available: ${available.join(', ')}`
    );
  }
  await pullEnvironment(project, environment, requireEnvironment(secret, ctx.project, environment));
  console.log(`Downloaded ${ctx.project}/${environment} from AWS Secrets Manager`);
}
