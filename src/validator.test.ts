import { describe, expect, test } from "bun:test";
import { coerceValue, validateEnv } from "./validator";
import type { EnvVarSchema } from "./types";

describe("coerceValue", () => {
  test("rejects non-numeric int values", () => {
    expect(() => coerceValue("12abc", "int")).toThrow();
    expect(() => coerceValue("1.2", "int")).toThrow();
  });

  test("accepts valid int values", () => {
    expect(coerceValue("12", "int")).toBe(12);
    expect(coerceValue("-7", "int")).toBe(-7);
  });

  test("rejects non-numeric float values", () => {
    expect(() => coerceValue("1.2.3", "float")).toThrow();
    expect(() => coerceValue("abc", "float")).toThrow();
  });

  test("accepts valid float values", () => {
    expect(coerceValue("1.25", "float")).toBe(1.25);
    expect(coerceValue(".5", "float")).toBe(0.5);
  });
});

describe("validateEnv", () => {
  test("format validators with global flag are stable", () => {
    const schema: EnvVarSchema[] = [
      {
        name: "TOKEN",
        type: "string",
        optional: false,
        validators: [{ kind: "format", pattern: /foo/g }],
        defaultValue: null,
        lineNumber: 1,
      },
    ];

    const values = { TOKEN: "foo" };

    const first = validateEnv(schema, values);
    const second = validateEnv(schema, values);

    expect(first.valid).toBe(true);
    expect(second.valid).toBe(true);
  });
});
