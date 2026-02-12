import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { setEnvVarIfUnset } from "./env";
import { parseEnvValues } from "./parser";

export function loadEnvFromPaths(paths: string[]): void {
  const envFiles = [".env.local", ".env"];
  const seen = new Set<string>();

  for (const basePath of paths) {
    if (!basePath || seen.has(basePath)) continue;
    seen.add(basePath);

    for (const file of envFiles) {
      const path = join(basePath, file);
      if (!existsSync(path)) continue;
      const content = readFileSync(path, "utf8");
      const values = parseEnvValues(content);
      for (const [key, value] of Object.entries(values)) {
        setEnvVarIfUnset(key, value);
      }
    }
  }
}
