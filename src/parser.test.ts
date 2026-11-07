import { describe, expect, test } from "bun:test";
import {
  envValuesEqual,
  generateLocalEnvContent,
  parseEnvFile,
  parseEnvValues,
  parseSchemaComment,
  serializeEnvValues,
  type Validator,
} from "./parser";
import { ensureHeader, parseHeader, setHeaderVersion } from "./metadata";

type FormatValidator = Extract<Validator, { kind: "format" }>;

describe("parseHeader", () => {
  test("parses valid header", () => {
    expect(parseHeader("# env-manager: my-project | v12")).toEqual({
      project: "my-project",
      version: 12,
    });
  });

  test("drops legacy sync dates and missing versions", () => {
    expect(
      parseHeader("# env-manager: my-project | 2025-01-15T10:30:00-05:00")
    ).toEqual({ project: "my-project", version: null });
    expect(parseHeader("# env-manager: my-project")).toEqual({
      project: "my-project",
      version: null,
    });
  });

  test("returns null for non-header comment", () => {
    expect(parseHeader("# just a comment")).toBeNull();
    expect(parseHeader("FOO=bar")).toBeNull();
  });

  test("handles project names with dashes and underscores", () => {
    const result = parseHeader(
      "# env-manager: my_cool-project | 2025-01-15T10:30:00Z"
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

  test("parses file type", () => {
    expect(parseSchemaComment("# {file}")?.type).toBe("file");
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

describe("schema validators", () => {
  const validators = (comment: string) => parseSchemaComment(comment)?.validators;

  test("parse numeric bounds including negatives and decimals", () => {
    expect(validators("# {int:min(-100)}")).toEqual([{ kind: "min", value: -100 }]);
    expect(validators("# {float:min(0.5),max(1.0)}")).toEqual([
      { kind: "min", value: 0.5 },
      { kind: "max", value: 1.0 },
    ]);
  });

  test("parse format regexes with flags", () => {
    const [format] = validators("# {string:format(/test/gi)}") as FormatValidator[];
    expect(format.pattern).toEqual(/test/gi);
  });

  test("reject unknown, mistyped and malformed validators", () => {
    expect(() => parseSchemaComment("# {int:unknown(1)}")).toThrow("Invalid validator syntax");
    expect(() => parseSchemaComment("# {string:min(1)}")).toThrow("min() is not valid for type string");
    expect(() => parseSchemaComment("# {int:format(/^x/)}")).toThrow("format() is not valid for type int");
    expect(() => parseSchemaComment("# {int:min(1),oops}")).toThrow("Invalid validator syntax");
    expect(() => parseSchemaComment("# {string:format(invalid)}")).toThrow("Invalid regex format");
  });
});

describe("parseEnvFile", () => {
  test("parses complete env file", () => {
    const content = `# env-manager: test-project | v3

FOO= # {optional float}
# {string}
BAR='some default value'
PORT=3000 # {int:min(3000),max(10000)}
`;
    const result = parseEnvFile(content);

    expect(result.project).toBe("test-project");

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

  test("finds header after leading comments", () => {
    const content = `# comment
# another
# env-manager: test-project | 2025-01-15T10:30:00-05:00

FOO=bar # {string}
`;
    const result = parseEnvFile(content);
    expect(result.project).toBe("test-project");
    expect(result.schema[0].name).toBe("FOO");
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

  test("ignores inline comments inside quotes", () => {
    const content = `FOO="hash#inside" # {string}
`;
    const result = parseEnvFile(content);
    expect(result.schema[0].defaultValue).toBe("hash#inside");
  });

  test("handles empty file", () => {
    const result = parseEnvFile("");
    expect(result.project).toBeNull();
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

  test("strips inline comments outside quotes", () => {
    const result = parseEnvValues(`FOO=bar # comment
BAR="hash#inside" # keep
BAZ=qux#not-comment
`);
    expect(result).toEqual({
      FOO: "bar",
      BAR: "hash#inside",
      BAZ: "qux#not-comment",
    });
  });

  test("handles escaped quotes and backslashes in quoted values", () => {
    const result = parseEnvValues(`FOO='it\\'s fine' # comment
BAR='C:\\\\secrets\\\\key'
`);
    expect(result).toEqual({
      FOO: "it's fine",
      BAR: "C:\\secrets\\key",
    });
  });
});

describe("setHeaderVersion", () => {
  test("updates header after leading comments", () => {
    const input = `# comment
# env-manager: demo | v1

FOO=bar
`;
    expect(setHeaderVersion(input, 2).split("\n")[1]).toBe(
      "# env-manager: demo | v2"
    );
  });

  test("replaces a legacy sync date with the version", () => {
    expect(
      setHeaderVersion("# env-manager: demo | 2025-01-01T00:00:00Z\n", 4)
    ).toBe("# env-manager: demo | v4\n");
  });

  test("adds a header when one is missing", () => {
    expect(ensureHeader("FOO=bar\n", "demo")).toBe(`# env-manager: demo

FOO=bar
`);
  });

});

describe("generateLocalEnvContent", () => {
  test("adds schema comments and quotes non-numeric values", () => {
    const content = generateLocalEnvContent(
      [
        {
          name: "API_KEY",
          type: "string",
          optional: false,
          validators: [],
          defaultValue: null,
          lineNumber: 1,
        },
        {
          name: "PORT",
          type: "int",
          optional: false,
          validators: [],
          defaultValue: null,
          lineNumber: 2,
        },
        {
          name: "THRESHOLD",
          type: "float",
          optional: false,
          validators: [],
          defaultValue: null,
          lineNumber: 3,
        },
        {
          name: "ENABLED",
          type: "bool",
          optional: false,
          validators: [],
          defaultValue: null,
          lineNumber: 4,
        },
      ],
      {
        API_KEY: "sk-test",
        PORT: "3000",
        THRESHOLD: "0.25",
        ENABLED: "true",
      }
    );

    expect(content).toBe(`API_KEY='sk-test' # {string}
PORT=3000 # {int}
THRESHOLD=0.25 # {float}
ENABLED='true' # {bool}
`);
  });

  test("keeps non-schema keys and round-trips escaped single quotes", () => {
    const content = generateLocalEnvContent(
      [
        {
          name: "NAME",
          type: "string",
          optional: false,
          validators: [],
          defaultValue: null,
          lineNumber: 1,
        },
      ],
      {
        NAME: "C:\\O'Reilly",
        EXTRA: "yes",
      }
    );

    expect(content).toBe(`NAME='C:\\\\O\\'Reilly' # {string}
EXTRA='yes'
`);
    expect(parseEnvValues(content)).toEqual({
      NAME: "C:\\O'Reilly",
      EXTRA: "yes",
    });
  });
});

describe("env value helpers", () => {
  test("apostrophes inside unquoted values do not hide the inline schema", () => {
    expect(parseEnvFile("NAME=O'Brien # {string}\n").schema[0]).toMatchObject({ name: "NAME", type: "string", defaultValue: "O'Brien" });
    expect(parseEnvValues("NAME=O'Brien # note\n")).toEqual({ NAME: "O'Brien" });
  });

  test("serialized values survive a parse round trip and compare by key/value", () => {
    const values = { PASS: "abc #def", QUOTED: "'x'", SPACED: " lead", PORT: "3000" };
    expect(serializeEnvValues(values)).toBe(
      "PASS='abc #def'\nQUOTED='\\'x\\''\nSPACED=' lead'\nPORT=3000"
    );
    expect(parseEnvValues(serializeEnvValues(values))).toEqual(values);
    expect(
      envValuesEqual({ FOO: "one", BAR: "two" }, { BAR: "two", FOO: "one" })
    ).toBe(true);
    expect(envValuesEqual({ FOO: "one" }, { FOO: "two" })).toBe(false);
  });
});
