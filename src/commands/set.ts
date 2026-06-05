import { parseEnvFile } from '../parser';
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

  const normalizedField = normalizeValuesConfigField(field);
  const content = await envFile.text();
  const parsed = parseEnvFile(content);
  if (parsed.header && parsed.header.project !== ctx.project) {
    throw new EnvManagerError(
      `.env project "${parsed.header.project}" does not match --project "${ctx.project}"`
    );
  }

  const updated = upsertValuesConfigField(
    content,
    normalizedField,
    value
  );
  await Bun.write(envPath, updated);

  console.log(`Set ${normalizedField} to ${value}`);
}
