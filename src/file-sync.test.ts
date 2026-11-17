import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { collectFilePayload, writeFilesFromPayload } from "./file-sync";
import type { EnvVarSchema } from "./parser";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "env-manager-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function fileSchema(overrides: Partial<EnvVarSchema> = {}): EnvVarSchema {
  return { name: "CERT", type: "file", optional: false, validators: [], defaultValue: null, lineNumber: 1, ...overrides };
}

describe("file sync", () => {
  test("a file variable stores the contents at its path, from the value or the schema default, and writes them back to that path", async () => {
    await withTempDir(async (dir) => {
      await writeFile(path.join(dir, "cert.pem"), "from value");
      await writeFile(path.join(dir, "default.pem"), "from default");
      const schema = [fileSchema(), fileSchema({ name: "FALLBACK", defaultValue: "default.pem" })];
      const files = await collectFilePayload(schema, { CERT: "cert.pem" }, dir);
      expect(files).toEqual({ CERT: "from value", FALLBACK: "from default" });

      const clone = path.join(dir, "clone");
      await writeFilesFromPayload(schema, { CERT: "secrets/cert.pem", FALLBACK: "default.pem" }, files, clone);
      expect(await readFile(path.join(clone, "secrets/cert.pem"), "utf8")).toBe("from value");
      expect(await readFile(path.join(clone, "default.pem"), "utf8")).toBe("from default");
    });
  });

  test("a file that is not valid UTF-8 is rejected instead of stored", async () => {
    await withTempDir(async (dir) => {
      await writeFile(path.join(dir, "cert.pem"), Buffer.from([0xff, 0xfe, 0xfd]));
      await expect(collectFilePayload([fileSchema()], { CERT: "cert.pem" }, dir)).rejects.toThrow("not valid UTF-8");
    });
  });
});
