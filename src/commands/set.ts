import { join } from 'node:path';
import { isSettingField, SETTING_FIELDS, settingKey, upsertSetting } from '../config';
import { EnvManagerError } from '../errors';
import { writeManagedFile } from '../files';
import { loadProject, parseProjectConfig, readEnvFile, type CommandContext } from '../project';

export async function setCommand(ctx: CommandContext, field: string, value: string): Promise<void> {
  if (!isSettingField(field)) {
    throw new EnvManagerError(`Unknown field "${field}". Supported fields: ${SETTING_FIELDS.join(', ')}`);
  }
  const content = await readEnvFile(ctx);
  const key = parseProjectConfig(ctx, content).modern ? settingKey(field) : field;
  const updated = upsertSetting(content, key, value);
  if (settingKey(field) === 'local') parseProjectConfig(ctx, updated);
  else await loadProject(ctx, updated);
  await writeManagedFile(join(ctx.cwd, '.env'), updated);
  console.log(`Set ${key} to ${value}`);
}
