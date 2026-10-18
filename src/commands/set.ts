import { planGeneration } from './generate';
import { parseRootConfig, upsertSetting } from '../config';
import { writeManagedFile } from '../git-updates';
import type { CommandContext } from '../types';
import { EnvManagerError } from '../types';

const FIELDS = ['local', 'format', 'path', 'generate', 'values.format', 'values.path'];

export async function setCommand(
  ctx: CommandContext,
  field: string,
  value: string
): Promise<void> {
  const envPath = `${ctx.cwd}/.env`;
  const envFile = Bun.file(envPath);
  if (!(await envFile.exists())) {
    throw new EnvManagerError(`.env not found at ${envPath}`);
  }

  if (!FIELDS.includes(field)) {
    throw new EnvManagerError(`Unknown field "${field}". Supported fields: ${FIELDS.join(', ')}`);
  }
  const content = await envFile.text();
  const parsed = parseRootConfig(content, envPath);
  if (parsed.header && parsed.header.project !== ctx.project) {
    throw new EnvManagerError(
      `.env project "${parsed.header.project}" does not match --project "${ctx.project}"`
    );
  }

  const normalizedField = parsed.modern ? field.replace('values.', '') : field;
  const updated = upsertSetting(content, normalizedField, value);
  const config = parseRootConfig(updated, envPath);
  const incompleteLegacy = !config.modern && !config.targets.length && !!config.format !== !!config.path;
  if (field !== 'local' && !incompleteLegacy) await planGeneration(ctx, updated);
  await writeManagedFile(envPath, updated);

  console.log(`Set ${normalizedField} to ${value}`);
}
