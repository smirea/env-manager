import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { collectFilePayload, writeFilesFromPayload } from "./file-sync";
import type { EnvVarSchema } from "./types";
import { EnvManagerError } from "./types";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "env-manager-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function fileSchema(overrides: Partial<EnvVarSchema> = {}): EnvVarSchema {
  return {
    name: "CERT",
    type: "file",
    optional: false,
    validators: [],
    defaultValue: null,
    lineNumber: 1,
    ...overrides,
  };
}

describe("file sync", () => {
  test("collectFilePayload reads file contents", async () => {
    await withTempDir(async (dir) => {
      await writeFile(path.join(dir, "cert.pem"), "hello");
      const files = await collectFilePayload(
        [fileSchema()],
        { CERT: "cert.pem" },
        dir
      );
      expect(files).toEqual({ CERT: "hello" });
    });
  });

  test("collectFilePayload uses defaultValue when no value present", async () => {
    await withTempDir(async (dir) => {
      await writeFile(path.join(dir, "cert.pem"), "default");
      const files = await collectFilePayload(
        [fileSchema({ defaultValue: "cert.pem" })],
        {},
        dir
      );
      expect(files).toEqual({ CERT: "default" });
    });
  });

  test("collectFilePayload throws when required path missing", async () => {
    await withTempDir(async (dir) => {
      await expect(
        collectFilePayload([fileSchema()], {}, dir)
      ).rejects.toThrow(EnvManagerError);
    });
  });

  test("collectFilePayload throws on non-utf8 file", async () => {
    await withTempDir(async (dir) => {
      const binary = Buffer.from([0xff, 0xfe, 0xfd]);
      await writeFile(path.join(dir, "cert.pem"), binary);
      await expect(
        collectFilePayload([fileSchema()], { CERT: "cert.pem" }, dir)
      ).rejects.toThrow(EnvManagerError);
    });
  });

  test("writeFilesFromPayload writes files to target path", async () => {
    await withTempDir(async (dir) => {
      await writeFilesFromPayload(
        [fileSchema()],
        { CERT: "secrets/cert.pem" },
        { CERT: "hello" },
        dir
      );
      const content = await readFile(
        path.join(dir, "secrets", "cert.pem"),
        "utf8"
      );
      expect(content).toBe("hello");
    });
  });

  test("writeFilesFromPayload throws when file contents missing", async () => {
    await withTempDir(async (dir) => {
      await expect(
        writeFilesFromPayload([fileSchema()], { CERT: "cert.pem" }, {}, dir)
      ).rejects.toThrow(EnvManagerError);
    });
  });

  test("writeFilesFromPayload skips optional when path missing", async () => {
    await withTempDir(async (dir) => {
      await writeFilesFromPayload(
        [fileSchema({ optional: true })],
        {},
        undefined,
        dir
      );
    });
  });
});
