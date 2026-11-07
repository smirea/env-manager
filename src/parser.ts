import { EnvManagerError } from "./errors";
import { parseHeader } from "./metadata";

export const SCHEMA_TYPES = ["string", "int", "float", "bool", "url", "email", "file"] as const;
export type SchemaType = (typeof SCHEMA_TYPES)[number];

export type Validator =
  | { kind: "min"; value: number }
  | { kind: "max"; value: number }
  | { kind: "format"; pattern: RegExp };

export interface EnvVarSchema {
  name: string;
  type: SchemaType;
  optional: boolean;
  validators: Validator[];
  defaultValue: string | null;
  lineNumber: number;
}

export interface ParsedEnvFile {
  project: string | null;
  schema: EnvVarSchema[];
}

export type EnvValues = Record<string, string>;

export const ENV_NAME_PATTERN = /[A-Z_][A-Z0-9_]*/i;
const ENV_LINE_PATTERN = new RegExp(`^(${ENV_NAME_PATTERN.source})\\s*=(.*)$`, "i");
export const NUMERIC_VALUE_PATTERN = /^[+-]?(?:\d+\.?\d*|\.\d+)$/;
const SCHEMA_TYPE_PATTERN = new RegExp(`^(optional\\s+)?(${SCHEMA_TYPES.join("|")})(?::(.+))?$`);

function parseFormatRegex(formatStr: string): RegExp {
  const match = formatStr.match(/^\/(.+)\/([gimsuy]*)$/);
  if (!match) throw new EnvManagerError(`Invalid regex format: ${formatStr}`);
  try {
    return new RegExp(match[1], match[2]);
  } catch (error) {
    throw new EnvManagerError(error instanceof Error ? error.message : String(error));
  }
}

function parseValidators(
  validatorStr: string,
  type: SchemaType
): Validator[] {
  if (!validatorStr.trim()) return [];

  const validators: Validator[] = [];
  let remaining = validatorStr.trim();
  while (remaining) {
    const start = remaining.match(/^(min|max|format)\(/);
    if (!start) throw new EnvManagerError(`Invalid validator syntax: ${validatorStr}`);
    const kind = start[1];
    const offset = start[0].length;
    let end = offset;
    if (kind === "format") {
      if (remaining[offset] !== '/') throw new EnvManagerError(`Invalid regex format: ${remaining}`);
      let escaped = false;
      let characterClass = false;
      let closed = false;
      for (end = offset + 1; end < remaining.length; end++) {
        const char = remaining[end];
        if (escaped) { escaped = false; continue; }
        if (char === "\\") { escaped = true; continue; }
        if (char === '[') characterClass = true;
        if (char === ']') characterClass = false;
        if (char === '/' && !characterClass) { closed = true; break; }
      }
      if (!closed) throw new EnvManagerError(`Invalid regex format: ${remaining}`);
      end++;
      while (/[a-z]/i.test(remaining[end] ?? '') && end < remaining.length) end++;
    } else {
      end = remaining.indexOf(')', offset);
    }
    if (end < offset || remaining[end] !== ')') throw new EnvManagerError(`Invalid validator syntax: ${validatorStr}`);
    const value = remaining.slice(offset, end);
    if (kind === "min" || kind === "max") {
      if (type !== "int" && type !== "float") {
        throw new EnvManagerError(`${kind}() is not valid for type ${type}`);
      }
      const parsed = Number(value);
      if (!NUMERIC_VALUE_PATTERN.test(value.trim()) || !Number.isFinite(parsed)) {
        throw new EnvManagerError(`Invalid ${kind}() value: ${value}`);
      }
      validators.push({ kind, value: parsed });
    } else if (kind === "format") {
      if (type !== "string") {
        throw new EnvManagerError(`format() is not valid for type ${type}`);
      }
      validators.push({ kind: "format", pattern: parseFormatRegex(value) });
    }
    remaining = remaining.slice(end + 1).trim();
    if (remaining) {
      if (!remaining.startsWith(',')) throw new EnvManagerError(`Invalid validator syntax: ${validatorStr}`);
      remaining = remaining.slice(1).trim();
      if (!remaining) throw new EnvManagerError(`Invalid validator syntax: ${validatorStr}`);
    }
  }

  return validators;
}

export function parseSchemaComment(comment: string): {
  type: SchemaType;
  optional: boolean;
  validators: Validator[];
} | null {
  const match = comment.match(/^\s*#\s*\{\s*(.+?)\s*\}\s*$/);
  if (!match) return null;

  const inner = match[1].trim();
  const typeMatch = inner.match(SCHEMA_TYPE_PATTERN);
  if (!typeMatch) return null;

  const optional = !!typeMatch[1];
  const type = typeMatch[2] as SchemaType;
  const validatorStr = typeMatch[3] || "";

  return {
    type,
    optional,
    validators: parseValidators(validatorStr, type),
  };
}

function isEscaped(value: string, index: number): boolean {
  let backslashes = 0;
  for (let i = index - 1; i >= 0 && value[i] === "\\"; i--) {
    backslashes++;
  }
  return backslashes % 2 === 1;
}

function isWrappedInQuotes(value: string, quote: "'" | '"'): boolean {
  return (
    value.length >= 2 &&
    value.startsWith(quote) &&
    value.endsWith(quote) &&
    !isEscaped(value, value.length - 1)
  );
}

function unescapeQuotedValue(value: string, quote: "'" | '"'): string {
  let result = "";
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === "\\" && i + 1 < value.length) {
      const next = value[i + 1];
      if (next === "\\" || next === quote) {
        result += next;
        i++;
        continue;
      }
    }
    result += ch;
  }
  return result;
}

export function findInlineCommentIndex(value: string): number {
  let from = value.length - value.trimStart().length;
  const quote = value[from];
  if (quote === "'" || quote === '"') {
    for (let i = from + 1; i < value.length; i++) {
      if (value[i] === quote && !isEscaped(value, i)) {
        from = i + 1;
        break;
      }
    }
  }
  for (let i = from; i < value.length; i++) {
    if (value[i] === "#" && (i === 0 || /\s/.test(value[i - 1]))) return i;
  }
  return -1;
}

export function parseEnvLine(line: string): {
  name: string;
  value: string | null;
  inlineComment: string | null;
} | null {
  const match = line.match(ENV_LINE_PATTERN);
  if (!match) return null;

  const name = match[1];
  let rest = match[2];

  let value: string | null = null;
  let inlineComment: string | null = null;

  const commentIdx = findInlineCommentIndex(rest);
  if (commentIdx !== -1) {
    inlineComment = rest.slice(commentIdx);
    rest = rest.slice(0, commentIdx);
  }

  rest = rest.trim();
  if (rest === "") {
    value = null;
  } else if (isWrappedInQuotes(rest, "'")) {
    value = unescapeQuotedValue(rest.slice(1, -1), "'");
  } else if (isWrappedInQuotes(rest, '"')) {
    value = unescapeQuotedValue(rest.slice(1, -1), '"');
  } else {
    value = rest;
  }

  return { name, value, inlineComment };
}

export function parseEnvFile(content: string): ParsedEnvFile {
  const lines = content.split("\n");
  const schema: EnvVarSchema[] = [];
  let pendingSchema: {
    type: SchemaType;
    optional: boolean;
    validators: Validator[];
  } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimStart();
    const lineNumber = i + 1;

    const envLine = parseEnvLine(line);
    if (envLine) {
      let schemaInfo = pendingSchema;

      if (envLine.inlineComment) {
        const inlineSchema = parseSchemaComment(envLine.inlineComment);
        if (inlineSchema) {
          schemaInfo = inlineSchema;
        }
      }

      if (schemaInfo) {
        schema.push({
          name: envLine.name,
          type: schemaInfo.type,
          optional: schemaInfo.optional,
          validators: schemaInfo.validators,
          defaultValue: envLine.value,
          lineNumber,
        });
      }

      pendingSchema = null;
      continue;
    }

    const schemaComment = parseSchemaComment(line);
    if (schemaComment) {
      pendingSchema = schemaComment;
      continue;
    }

    if (line.trim() === "" || line.trim().startsWith("#")) {
      pendingSchema = null;
    }
  }

  return { project: findProject(content), schema };
}

function findProject(content: string): string | null {
  for (const line of content.split("\n")) {
    const header = parseHeader(line);
    if (header) return header.project;
  }
  return null;
}

export function parseEnvValues(content: string): EnvValues {
  const values: EnvValues = {};
  for (const line of content.split("\n")) {
    const entry = parseEnvLine(line.trim());
    if (entry) values[entry.name] = entry.value ?? "";
  }
  return values;
}

export function schemaValue(entry: EnvVarSchema, values: EnvValues): string | null {
  return (values[entry.name] ?? entry.defaultValue) || null;
}

export function selectValues(schema: EnvVarSchema[], values: EnvValues): EnvValues {
  return Object.fromEntries(schema.map(entry => [entry.name, schemaValue(entry, values) ?? ""]));
}

function escapeSingleQuotedValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function formatLocalValue(value: string): string {
  if (NUMERIC_VALUE_PATTERN.test(value)) {
    return value;
  }
  return `'${escapeSingleQuotedValue(value)}'`;
}

export function generateLocalEnvContent(
  schema: EnvVarSchema[],
  values: EnvValues
): string {
  const lines: string[] = [];
  const schemaNames = new Set(schema.map((entry) => entry.name));
  for (const entry of schema) {
    if (Object.hasOwn(values, entry.name)) {
      lines.push(`${entry.name}=${formatLocalValue(values[entry.name])} ${formatSchemaComment(entry)}`);
    }
  }
  for (const [name, value] of Object.entries(values)) {
    if (!schemaNames.has(name)) lines.push(`${name}=${formatLocalValue(value)}`);
  }
  return lines.length === 0 ? "" : lines.join("\n") + "\n";
}

export function formatSchemaComment(s: EnvVarSchema): string {
  let inner = "";
  if (s.optional) inner += "optional ";
  inner += s.type;

  const validatorStrs: string[] = [];
  for (const v of s.validators) {
    if (v.kind === "min") validatorStrs.push(`min(${v.value})`);
    if (v.kind === "max") validatorStrs.push(`max(${v.value})`);
    if (v.kind === "format") validatorStrs.push(`format(${v.pattern})`);
  }
  if (validatorStrs.length > 0) {
    inner += ":" + validatorStrs.join(",");
  }

  return `# {${inner}}`;
}

export function serializeEnvValues(values: EnvValues): string {
  return Object.entries(values)
    .map(([key, value]) => `${key}=${formatLocalValue(value)}`)
    .join("\n");
}

export function envValuesEqual(
  left: EnvValues,
  right: EnvValues
): boolean {
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  if (leftKeys.length !== rightKeys.length) return false;
  for (let i = 0; i < leftKeys.length; i++) {
    const key = leftKeys[i];
    if (key !== rightKeys[i]) return false;
    if (left[key] !== right[key]) return false;
  }
  return true;
}

export function appendSchemaEntry(
  content: string,
  name: string,
  type: string
): string {
  return content.trimEnd() + `\n${name}= # {${type}}\n`;
}
