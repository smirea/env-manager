import { describe, expect, test } from "bun:test";
import {
  parseEnvFile,
  parseEnvValues,
  parseFormatRegex,
  parseHeader,
  parseSchemaComment,
  parseValidators,
} from "./parser";
import type { FormatValidator } from "./types";

describe("parseHeader", () => {
  test("parses valid header", () => {
    const result = parseHeader(
      "#env-manager: my-project | 2025-01-15T10:30:00-05:00"
    );
    expect(result).toEqual({
      project: "my-project",
      syncDate: "2025-01-15T10:30:00-05:00",
    });
  });

  test("returns null for non-header comment", () => {
    expect(parseHeader("# just a comment")).toBeNull();
    expect(parseHeader("FOO=bar")).toBeNull();
  });

  test("handles project names with dashes and underscores", () => {
    const result = parseHeader(
      "#env-manager: my_cool-project | 2025-01-15T10:30:00Z"
    );
    expect(result?.project).toBe("my_cool-project");
  });
});

describe("parseSchemaComment", () => {
  test("parses simple type", () => {
    expect(parseSchemaComment("# {string}")).toEqual({
      type: "string",
      optional: false,
      validators: [],
    });
  });

  test("parses optional flag", () => {
    expect(parseSchemaComment("# {optional float}")).toEqual({
      type: "float",
      optional: true,
      validators: [],
    });
  });

  test("parses type with validators", () => {
    const result = parseSchemaComment("# {int:min(0),max(100)}");
    expect(result).toEqual({
      type: "int",
      optional: false,
      validators: [
        { kind: "min", value: 0 },
        { kind: "max", value: 100 },
      ],
    });
  });

  test("parses format regex validator", () => {
    const result = parseSchemaComment("# {string:format(/^sk-/)}");
    expect(result?.validators[0]).toEqual({
      kind: "format",
      pattern: /^sk-/,
    });
  });

  test("parses complex regex with special chars", () => {
    const result = parseSchemaComment("# {string:format(/^openai-key_\\w+/)}");
    expect(result?.validators[0]).toEqual({
      kind: "format",
      pattern: /^openai-key_\w+/,
    });
  });

  test("parses url and email types", () => {
    expect(parseSchemaComment("# {url}")?.type).toBe("url");
    expect(parseSchemaComment("# {email}")?.type).toBe("email");
  });

  test("parses optional with validators", () => {
    const result = parseSchemaComment("# {optional int:min(3000),max(10000)}");
    expect(result).toEqual({
      type: "int",
      optional: true,
      validators: [
        { kind: "min", value: 3000 },
        { kind: "max", value: 10000 },
      ],
    });
  });

  test("returns null for non-schema comment", () => {
    expect(parseSchemaComment("# regular comment")).toBeNull();
    expect(parseSchemaComment("# {invalid}")).toBeNull();
  });

  test("parses bool type", () => {
    expect(parseSchemaComment("# {bool}")).toEqual({
      type: "bool",
      optional: false,
      validators: [],
    });
  });

  test("parses optional bool", () => {
    expect(parseSchemaComment("# {optional bool}")).toEqual({
      type: "bool",
      optional: true,
      validators: [],
    });
  });
});

describe("parseValidators", () => {
  test("parses min validator", () => {
    expect(parseValidators("min(0)", "int")).toEqual([
      { kind: "min", value: 0 },
    ]);
  });

  test("parses negative min", () => {
    expect(parseValidators("min(-100)", "int")).toEqual([
      { kind: "min", value: -100 },
    ]);
  });

  test("parses float min/max", () => {
    expect(parseValidators("min(0.5),max(1.0)", "float")).toEqual([
      { kind: "min", value: 0.5 },
      { kind: "max", value: 1.0 },
    ]);
  });

  test("parses format with flags", () => {
    const result = parseValidators("format(/^test/i)", "string");
    expect(result[0].kind).toBe("format");
    expect((result[0] as FormatValidator).pattern.flags).toBe("i");
  });

  test("returns empty array for empty string", () => {
    expect(parseValidators("", "string")).toEqual([]);
  });
});

describe("parseFormatRegex", () => {
  test("parses simple regex", () => {
    expect(parseFormatRegex("/^sk-/")).toEqual(/^sk-/);
  });

  test("parses regex with flags", () => {
    expect(parseFormatRegex("/test/gi")).toEqual(/test/gi);
  });

  test("throws on invalid format", () => {
    expect(() => parseFormatRegex("invalid")).toThrow();
  });
});

describe("parseEnvFile", () => {
  test("parses complete env file", () => {
    const content = `#env-manager: test-project | 2025-01-15T10:30:00-05:00

FOO= # {optional float}
# {string}
BAR='some default value'
PORT=3000 # {int:min(3000),max(10000)}
`;
    const result = parseEnvFile(content);

    expect(result.header).toEqual({
      project: "test-project",
      syncDate: "2025-01-15T10:30:00-05:00",
    });

    expect(result.schema.map((s) => s.name)).toEqual(["FOO", "BAR", "PORT"]);
    expect(result.schema).toHaveLength(3);

    expect(result.schema[0]).toMatchObject({
      name: "FOO",
      type: "float",
      optional: true,
      defaultValue: null,
    });

    expect(result.schema[1]).toMatchObject({
      name: "BAR",
      type: "string",
      optional: false,
      defaultValue: "some default value",
    });

    expect(result.schema[2]).toMatchObject({
      name: "PORT",
      type: "int",
      optional: false,
      defaultValue: "3000",
      validators: [
        { kind: "min", value: 3000 },
        { kind: "max", value: 10000 },
      ],
    });
  });

  test("handles schema comment on line before", () => {
    const content = `# {string}
FOO=bar
`;
    const result = parseEnvFile(content);
    expect(result.schema[0].name).toBe("FOO");
    expect(result.schema[0].type).toBe("string");
  });

  test("handles schema comment on same line", () => {
    const content = `FOO=bar # {string}
`;
    const result = parseEnvFile(content);
    expect(result.schema[0].name).toBe("FOO");
    expect(result.schema[0].type).toBe("string");
  });

  test("handles quoted default values", () => {
    const content = `FOO='hello world' # {string}
BAR="double quoted" # {string}
`;
    const result = parseEnvFile(content);
    expect(result.schema[0].defaultValue).toBe("hello world");
    expect(result.schema[1].defaultValue).toBe("double quoted");
  });

  test("handles empty file", () => {
    const result = parseEnvFile("");
    expect(result.header).toBeNull();
    expect(result.schema).toEqual([]);
  });

  test("ignores lines without schema", () => {
    const content = `# just a comment
FOO=bar
# another comment
`;
    const result = parseEnvFile(content);
    expect(result.schema).toEqual([]);
  });

  test("clears pending schema on blank line", () => {
    const content = `# {string}

FOO=bar
`;
    const result = parseEnvFile(content);
    expect(result.schema).toEqual([]);
  });
});

describe("parseEnvValues", () => {
  test("parses simple key=value", () => {
    expect(parseEnvValues("FOO=bar")).toEqual({ FOO: "bar" });
  });

  test("parses multiple lines", () => {
    const result = parseEnvValues(`FOO=bar
BAZ=qux`);
    expect(result).toEqual({ FOO: "bar", BAZ: "qux" });
  });

  test("handles quoted values", () => {
    const result = parseEnvValues(`FOO='hello world'
BAR="with spaces"`);
    expect(result).toEqual({
      FOO: "hello world",
      BAR: "with spaces",
    });
  });

  test("handles empty values", () => {
    expect(parseEnvValues("FOO=")).toEqual({ FOO: "" });
  });

  test("ignores comments and blank lines", () => {
    const result = parseEnvValues(`# comment
FOO=bar

# another
BAZ=qux
`);
    expect(result).toEqual({ FOO: "bar", BAZ: "qux" });
  });
});
