import { DEFAULT_READER_PATH, relativeOutput, upsertSetting } from '../config';
import { configError } from '../errors';
import { FORMATS } from '../formats';
import { writeManagedFile } from '../files';
import { validateEnvironmentName } from '../metadata';
import { assertTarget, materialize, renderEnvironment } from '../outputs';
import { parseEnvValues } from '../parser';
import { loadProject, type CommandContext } from '../project';
import { requireEnvironment, requireProject } from '../store';
import { readSelection } from '../values';

export async function generateCommand(
  ctx: CommandContext,
  outputPath?: string,
  options: { force?: boolean; target?: string } = {}
): Promise<void> {
  let project = await loadProject(ctx);
  const { config, envPath } = project;
  let content = project.content;
  if (!config.targets.length) {
    if (options.target) configError(envPath, 1, '--target requires target declarations.');
    if (outputPath && !FORMATS[project.values.format].reader) configError(envPath, 1, 'A reader output path only works when values.format is "ts".');
    if (outputPath) relativeOutput(outputPath, envPath, 1);
    if (outputPath && config.generate && outputPath !== config.generate && !options.force) configError(envPath, 1, `.env has ts path "${config.generate}" but "${outputPath}" was given. Pass --force to overwrite.`);
    if (!config.schema.length) configError(envPath, 1, 'No schema found in .env. Add schema comments like: # {string}');
    if (FORMATS[project.values.format].reader && (outputPath || config.generate || !config.modern)) {
      content = upsertSetting(content, config.modern ? 'generate' : 'ts', outputPath ?? config.generate ?? DEFAULT_READER_PATH);
    }
  } else if (outputPath) {
    if (!options.target) configError(envPath, 1, 'Use --target <name> with a positional reader path in a monorepo.');
    const target = config.targets.find(t => t.name === options.target);
    if (!target?.generate) configError(envPath, 1, 'A reader path requires a TypeScript target.');
    const path = relativeOutput(outputPath, envPath, target.line);
    if (path !== target.generate && !options.force) configError(envPath, target.line, 'Pass --force to overwrite the target generation path.');
    const lines = content.split('\n');
    lines[target.line - 1] = `${lines[target.line - 1].replace(/\s+generate=\S+/, '')} generate=${path}`;
    content = lines.join('\n');
  }
  if (content !== project.content) project = await loadProject(ctx, content);
  const { environment, loadedFrom } = await readSelection(project.root, project.values);
  if (loadedFrom && loadedFrom !== environment) {
    console.warn(`Warning: generating "${environment}" outputs from values loaded for "${loadedFrom}". Run "env-manager down" to load ${environment}.`);
  }
  await materialize(project, { target: options.target });
  await writeManagedFile(envPath, content);
}

export async function generateFromEnvironment(ctx: CommandContext, environment: string, options: { target?: string } = {}): Promise<void> {
  validateEnvironmentName(environment);
  const project = await loadProject(ctx);
  if (!project.config.targets.length) configError(project.envPath, 1, '--env needs target declarations: in a single-project setup the values file is the source. Use env-manager env set <env>.');
  assertTarget(project, options.target);
  const secret = await requireProject(ctx.project);
  const payload = requireEnvironment(secret, ctx.project, environment);
  await renderEnvironment(project, environment, parseEnvValues(payload.values), options);
}
