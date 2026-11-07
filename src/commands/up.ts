import { collectFilePayload } from '../file-sync';
import { writeManagedFile } from '../files';
import { EnvManagerError } from '../errors';
import { ensureHeader } from '../metadata';
import { materialize, versionRecordsEqual } from '../outputs';
import { envValuesEqual, parseEnvValues, serializeEnvValues } from '../parser';
import { loadProject, type CommandContext } from '../project';
import { canonicalSchema, readProject, writeProject } from '../store';
import { assertValid } from '../validator';
import { readSelection, readValues } from '../values';

export async function upCommand(ctx: CommandContext): Promise<void> {
  const project = await loadProject(ctx);
  const existing = await readProject(project.name);
  const { environment, loadedFrom } = await readSelection(project.root, project.values);
  const existingEnvironment = existing?.environments[environment];
  if (loadedFrom && loadedFrom !== environment) {
    const fix = existingEnvironment
      ? `Run "env-manager down" to load ${environment}`
      : `Run "env-manager env set ${environment} --no-local" to confirm seeding it from the current values, or "env-manager env set ${loadedFrom}" to switch back`;
    throw new EnvManagerError(`Refusing to upload: the values file holds "${loadedFrom}" values but environment "${environment}" is selected. ${fix}.`);
  }
  if (!project.config.project) {
    if (existing) throw new EnvManagerError('.env is missing env-manager header. Run: env-manager init');
    console.log(`Added env-manager header to ${project.envPath}`);
  }
  const content = ensureHeader(project.content, project.name);

  const values = await readValues(project.root, project.values);
  assertValid(project.config.schema, values);
  const files = await collectFilePayload(project.config.schema, values, project.root);

  const valuesChanged = !existingEnvironment
    || !envValuesEqual(values, parseEnvValues(existingEnvironment.values))
    || !envValuesEqual(files, existingEnvironment.files ?? {});
  const outputs = await materialize(project, { remote: existingEnvironment?.outputs });
  const changed = !existing
    || canonicalSchema(content) !== existing.schema
    || valuesChanged
    || !versionRecordsEqual(outputs, existingEnvironment?.outputs ?? {});

  if (changed) {
    await writeProject(project.name, {
      schema: content,
      environments: {
        ...existing?.environments,
        [environment]: {
          values: serializeEnvValues(values),
          syncDate: valuesChanged ? new Date().toISOString() : existingEnvironment!.syncDate,
          files: Object.keys(files).length > 0 ? files : undefined,
          outputs,
        },
      },
    });
  }
  await writeManagedFile(project.envPath, content);

  console.log(changed
    ? `Uploaded ${project.name}/${environment} to AWS Secrets Manager`
    : `${project.name}/${environment} is already up to date`);
}
