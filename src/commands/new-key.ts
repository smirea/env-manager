import { appendSchemaEntry } from '../parser';
import { collectFilePayload } from '../file-sync';
import { configError, EnvManagerError } from '../errors';
import { writeManagedFile } from '../files';
import { KEYS, type KeyOptions } from '../keys';
import { loadProject, type CommandContext } from '../project';
import { choose } from '../prompt';
import { GLOBAL_LABEL, readGlobals, saveGlobalValue } from '../store';
import { assertValid } from '../validator';
import { readSelection, readValues, writeSourceValues } from '../values';
import { upCommand } from './up';

export function listKeysCommand(): void {
  console.log('Available keys:');
  const maxLen = Math.max(...KEYS.map((k) => k.envName.length));
  for (const key of KEYS) {
    console.log(`  ${key.envName.padEnd(maxLen + 2)}${key.description}`);
  }
}

export async function newKeyCommand(
  ctx: CommandContext,
  keyName: string,
  options: KeyOptions & { assumeYes?: boolean } = {}
): Promise<void> {
  const { assumeYes = false, ...keyOptions } = options;
  const keyDef = KEYS.find(key => key.envName === keyName);
  if (!keyDef) {
    throw new EnvManagerError(`Unknown key: ${keyName}. Available: ${KEYS.map(k => k.envName).join(', ')}`);
  }
  keyDef.checkOptions(keyOptions);

  let project = await loadProject(ctx);
  if (!project.config.project) throw new EnvManagerError('.env is missing env-manager header. Run: env-manager init');
  if (!project.config.schema.some(entry => entry.name === keyName)) {
    if (project.config.targets.length) configError(project.envPath, 1, `Declare ${keyName} in a target selection before creating a key in a monorepo.`);
    console.log(`Adding ${keyName} to .env schema...`);
    project = await loadProject(ctx, appendSchemaEntry(project.content, keyName, keyDef.schemaType));
  }

  const globalValue = (await readGlobals()).values[keyName] || null;
  let key: string;
  if (globalValue && await choose(`${keyName} found in ${GLOBAL_LABEL}`, [`Use existing from ${GLOBAL_LABEL}`, 'Create new key'], assumeYes) === 1) {
    key = globalValue;
    console.log(`Using ${keyName} from ${GLOBAL_LABEL}`);
  } else {
    console.log(globalValue ? `Creating new ${keyName}...` : `Creating ${keyName}...`);
    key = await keyDef.resolve(ctx.project, keyOptions, assumeYes);
  }
  if (!keyDef.validate(key)) throw new EnvManagerError(`Invalid key format. Got: ${key.slice(0, 20)}...`);

  const values = await readValues(project.root, project.values);
  const valuesChanged = values[keyName] !== key;
  values[keyName] = key;
  assertValid(project.config.schema, values);
  await collectFilePayload(project.config.schema, values, project.root);

  await writeManagedFile(project.envPath, project.content);
  if (valuesChanged) await writeSourceValues(project.root, project.name, project.values, project.config.schema, values);
  await upCommand(ctx);

  if (key !== globalValue) {
    await saveGlobalValue(keyName, key, keyDef.schemaType, ctx.project);
    console.log(`Saved ${keyName} to ${GLOBAL_LABEL}`);
  }
  const { environment } = await readSelection(project.root, project.values);
  console.log(`Added ${keyName} and synced ${ctx.project}/${environment} to AWS`);
}
