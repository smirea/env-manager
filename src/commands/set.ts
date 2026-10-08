import { planGeneration } from './generate';
import { parseRootConfig, upsertSetting } from '../config';
import { writeManagedFile } from '../git-updates';
import type { CommandContext } from '../types';
import { EnvManagerError } from '../types';
import {
  normalizeValuesConfigField,
  upsertValuesConfigField,
} from '../values-config';

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

  const normalizedField = ['local', 'format', 'path', 'generate'].includes(field) ? field : normalizeValuesConfigField(field);
  const content = await envFile.text();
  const parsed = parseRootConfig(content, envPath);
  if (parsed.header && parsed.header.project !== ctx.project) {
    throw new EnvManagerError(
      `.env project "${parsed.header.project}" does not match --project "${ctx.project}"`
    );
  }

  const updated = !parsed.modern && (normalizedField === 'values.format' || normalizedField === 'values.path')
    ? upsertValuesConfigField(content, normalizedField, value)
    : upsertSetting(content, normalizedField.replace('values.', ''), value);
  const config = parseRootConfig(updated, envPath);
  const incompleteLegacy = !config.modern && !config.targets.length && !!config.format !== !!config.path;
  if (field !== 'local' && !incompleteLegacy) await planGeneration(ctx, updated);
  await writeManagedFile(envPath, updated);

  console.log(`Set ${normalizedField} to ${value}`);
}
