import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_ENVIRONMENT, validateEnvironmentName } from '../metadata';
import { loadProject, type CommandContext } from '../project';
import { environmentNames, readProject, requireEnvironment, requireProject, writeProject } from '../store';
import { readSelection, writeSelection } from '../values';
import { pullEnvironment } from './down';

// Outside local mode the switch pulls the environment like `down`, so the values file
// never holds one environment's values under another's label. A missing environment is
// seeded from the current values on the next `up`; the marker records that choice.
export async function envSetCommand(ctx: CommandContext, environment: string, options: { local?: boolean } = {}): Promise<void> {
  validateEnvironmentName(environment);
  const project = await loadProject(ctx);
  const selection = await readSelection(project.root, project.values);
  const loadedFrom = selection.loadedFrom ?? selection.environment;

  if (options.local) {
    await writeSelection(project.root, project.values, environment, loadedFrom);
    console.log(`Set default environment to ${environment}`);
    if (loadedFrom !== environment) {
      console.warn(`Warning: local mode cannot load "${environment}"; the values file still holds "${loadedFrom}" values. Run "env-manager down --no-local" to load them.`);
    }
    return;
  }

  const secret = await readProject(ctx.project);
  if (secret && Object.hasOwn(secret.environments, environment)) {
    await pullEnvironment(await loadProject(ctx, secret.schema), environment, secret.environments[environment]);
    console.log(`Set default environment to ${environment} and downloaded ${ctx.project}/${environment}`);
    return;
  }

  await writeSelection(project.root, project.values, environment, environment);
  console.log(`Set default environment to ${environment}`);
  console.warn(`Environment "${environment}" does not exist in AWS yet. The current values (from "${loadedFrom}") will seed it on the next "env-manager up".`);
}

export async function envListCommand(ctx: CommandContext): Promise<void> {
  const secret = await requireProject(ctx.project);
  const environments = environmentNames(secret);
  if (environments.length === 0) {
    console.log(`No environments found for project "${ctx.project}".`);
    return;
  }
  const project = existsSync(join(ctx.cwd, '.env')) ? await loadProject(ctx) : null;
  const current = project ? (await readSelection(project.root, project.values)).environment : DEFAULT_ENVIRONMENT;
  console.log('Environments:');
  for (const environment of environments) {
    console.log(`  ${environment}${environment === current ? ' (default)' : ''}`);
  }
}

export async function envRmCommand(ctx: CommandContext, environment: string): Promise<void> {
  const secret = await requireProject(ctx.project);
  requireEnvironment(secret, ctx.project, environment);
  const { [environment]: _removed, ...environments } = secret.environments;
  await writeProject(ctx.project, { schema: secret.schema, environments });
  console.log(`Removed environment ${environment} from project "${ctx.project}"`);
}
