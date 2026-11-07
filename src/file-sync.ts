import { resolve } from 'node:path';
import { EnvManagerError } from './errors';
import { writeManagedFile } from './files';
import { schemaValue, type EnvValues, type EnvVarSchema } from './parser';

function fileEntries(schema: EnvVarSchema[], values: EnvValues, cwd: string): { name: string; path: string }[] {
  const entries: { name: string; path: string }[] = [];
  for (const entry of schema) {
    if (entry.type !== 'file') continue;
    const value = schemaValue(entry, values);
    if (!value) {
      if (entry.optional) continue;
      throw new EnvManagerError(`Required file path ${entry.name} is not set`);
    }
    entries.push({ name: entry.name, path: resolve(cwd, value) });
  }
  return entries;
}

export async function collectFilePayload(schema: EnvVarSchema[], values: EnvValues, cwd: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  for (const { name, path } of fileEntries(schema, values, cwd)) {
    const file = Bun.file(path);
    if (!(await file.exists())) throw new EnvManagerError(`File for ${name} not found at ${path}`);
    try {
      files[name] = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
    } catch {
      throw new EnvManagerError(`File for ${name} is not valid UTF-8: ${path}`);
    }
  }
  return files;
}

export async function writeFilesFromPayload(
  schema: EnvVarSchema[],
  values: EnvValues,
  files: Record<string, string> | undefined,
  cwd: string
): Promise<void> {
  for (const { name, path } of fileEntries(schema, values, cwd)) {
    if (!files || !Object.hasOwn(files, name)) throw new EnvManagerError(`Missing file contents for ${name} in secret`);
    await writeManagedFile(path, files[name]);
  }
}
