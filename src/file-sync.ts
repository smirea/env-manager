import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { EnvValues, EnvVarSchema } from "./types";
import { EnvManagerError } from "./types";

function resolvePath(cwd: string, filePath: string): string {
  return path.resolve(cwd, filePath);
}

function getFilePathValue(
  schema: EnvVarSchema,
  values: EnvValues
): string | null {
  return values[schema.name] ?? schema.defaultValue;
}

export async function collectFilePayload(
  schema: EnvVarSchema[],
  values: EnvValues,
  cwd: string
): Promise<Record<string, string>> {
  const files: Record<string, string> = {};

  for (const s of schema) {
    if (s.type !== "file") continue;
    const rawValue = getFilePathValue(s, values);

    if (rawValue === null || rawValue === undefined || rawValue === "") {
      if (s.optional) continue;
      throw new EnvManagerError(`Required file path ${s.name} is not set`);
    }

    const fullPath = resolvePath(cwd, rawValue);
    const file = Bun.file(fullPath);
    if (!(await file.exists())) {
      throw new EnvManagerError(
        `File for ${s.name} not found at ${fullPath}`
      );
    }

    files[s.name] = await file.text();
  }

  return files;
}

export async function writeFilesFromPayload(
  schema: EnvVarSchema[],
  values: EnvValues,
  files: Record<string, string> | undefined,
  cwd: string
): Promise<void> {
  for (const s of schema) {
    if (s.type !== "file") continue;
    const rawValue = getFilePathValue(s, values);

    if (rawValue === null || rawValue === undefined || rawValue === "") {
      if (s.optional) continue;
      throw new EnvManagerError(`Missing file path for ${s.name}`);
    }

    if (!files || !Object.prototype.hasOwnProperty.call(files, s.name)) {
      throw new EnvManagerError(
        `Missing file contents for ${s.name} in secret`
      );
    }

    const fullPath = resolvePath(cwd, rawValue);
    await mkdir(path.dirname(fullPath), { recursive: true });
    await Bun.write(fullPath, files[s.name]);
  }
}
