import type {
  EnvFileHeader,
  EnvVarSchema,
  EnvValues,
  ParsedEnvFile,
  SchemaType,
  Validator,
} from "./types";
import { ParseError } from "./types";

const NUMERIC_VALUE_PATTERN = /^[+-]?(?:\d+\.?\d*|\.\d+)$/;
const SYNC_DATE_PLACEHOLDER = "__env_manager_sync_date__";

function formatHeaderLine(header: EnvFileHeader): string {
  return `# env-manager: ${header.project} | ${header.syncDate}`;
}

export function parseHeader(line: string): EnvFileHeader | null {
  const match = line.match(/^#\s*env-manager:\s*([^\s|]+)\s*\|\s*(.+)$/);
  if (!match) return null;
  return {
    project: match[1].trim(),
    syncDate: match[2].trim(),
  };
}

export function parseFormatRegex(formatStr: string): RegExp {
  const match = formatStr.match(/^\/(.+)\/([gimsuy]*)$/);
  if (!match) throw new Error(`Invalid regex format: ${formatStr}`);
  return new RegExp(match[1], match[2]);
}

export function parseValidators(
  validatorStr: string,
  type: SchemaType
): Validator[] {
  if (!validatorStr.trim()) return [];

  const validators: Validator[] = [];
  const pattern = /(min|max|format)\(([^)]+)\)/g;
  let match;
  let lastIndex = 0;

  while ((match = pattern.exec(validatorStr)) !== null) {
    const between = validatorStr.slice(lastIndex, match.index);
    if (between.replace(/[,\s]/g, "") !== "") {
      throw new ParseError(`Invalid validator syntax: ${validatorStr}`);
    }

    const [, kind, value] = match;
    if (kind === "min") {
      if (type !== "int" && type !== "float") {
        throw new ParseError(`min() is not valid for type ${type}`);
      }
      const parsed = parseFloat(value);
      if (Number.isNaN(parsed)) {
        throw new ParseError(`Invalid min() value: ${value}`);
      }
      validators.push({ kind: "min", value: parsed });
    } else if (kind === "max") {
      if (type !== "int" && type !== "float") {
        throw new ParseError(`max() is not valid for type ${type}`);
      }
      const parsed = parseFloat(value);
      if (Number.isNaN(parsed)) {
        throw new ParseError(`Invalid max() value: ${value}`);
      }
      validators.push({ kind: "max", value: parsed });
    } else if (kind === "format") {
      if (type !== "string") {
        throw new ParseError(`format() is not valid for type ${type}`);
      }
      try {
        validators.push({ kind: "format", pattern: parseFormatRegex(value) });
      } catch (error) {
        throw new ParseError(
          error instanceof Error ? error.message : String(error)
        );
      }
    }
    lastIndex = pattern.lastIndex;
  }

  const trailing = validatorStr.slice(lastIndex);
  if (trailing.replace(/[,\s]/g, "") !== "") {
    throw new ParseError(`Invalid validator syntax: ${validatorStr}`);
  }
  if (validators.length === 0) {
    throw new ParseError(`Invalid validator syntax: ${validatorStr}`);
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
  const typeMatch = inner.match(
    /^(optional\s+)?(string|int|float|bool|url|email|file)(?::(.+))?$/
  );
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

function findInlineCommentIndex(value: string): number {
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === "'" && !inDouble && !isEscaped(value, i)) {
      inSingle = !inSingle;
      continue;
    }
    if (ch === '"' && !inSingle && !isEscaped(value, i)) {
      inDouble = !inDouble;
      continue;
    }
    if (ch === "#" && !inSingle && !inDouble) {
      if (i === 0 || /\s/.test(value[i - 1])) return i;
    }
  }

  return -1;
}

function parseEnvLine(line: string): {
  name: string;
  value: string | null;
  inlineComment: string | null;
} | null {
  const match = line.match(/^([A-Z_][A-Z0-9_]*)\s*=(.*)$/i);
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
  let header: EnvFileHeader | null = null;
  let headerSearchActive = true;
  let pendingSchema: {
    type: SchemaType;
    optional: boolean;
    validators: Validator[];
  } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNumber = i + 1;

    if (headerSearchActive && !header) {
      const h = parseHeader(line);
      if (h) {
        header = h;
        continue;
      }
      const trimmed = line.trim();
      if (trimmed === "") {
        continue;
      }
      if (trimmed.startsWith("#")) {
        const schemaComment = parseSchemaComment(line);
        if (!schemaComment) {
          continue;
        }
      }
      headerSearchActive = false;
    }

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

  return { header, schema, rawContent: content };
}

export function parseEnvValues(content: string): EnvValues {
  const values: EnvValues = {};
  const lines = content.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;

    const match = trimmed.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/i);
    if (!match) continue;

    const name = match[1];
    let value = match[2];
    const commentIdx = findInlineCommentIndex(value);
    if (commentIdx !== -1) {
      value = value.slice(0, commentIdx);
    }
    value = value.trim();

    if (
      isWrappedInQuotes(value, "'") ||
      isWrappedInQuotes(value, '"')
    ) {
      const quote = value[0] as "'" | '"';
      value = unescapeQuotedValue(value.slice(1, -1), quote);
    }

    values[name] = value;
  }

  return values;
}

export function generateEnvContent(
  header: EnvFileHeader,
  schema: EnvVarSchema[],
  values: EnvValues
): string {
  const lines: string[] = [];
  lines.push(formatHeaderLine(header));
  lines.push("");

  for (const s of schema) {
    const schemaStr = formatSchemaComment(s);
    const value = values[s.name] ?? s.defaultValue ?? "";
    lines.push(`${s.name}=${value} ${schemaStr}`);
  }

  return lines.join("\n") + "\n";
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
  values: EnvValues,
  header?: EnvFileHeader
): string {
  const lines: string[] = header ? [formatHeaderLine(header), ""] : [];
  const schemaByName = new Map(schema.map((entry) => [entry.name, entry]));
  const emitted = new Set<string>();

  for (const entry of schema) {
    if (!Object.prototype.hasOwnProperty.call(values, entry.name)) {
      continue;
    }
    const value = values[entry.name];
    lines.push(
      `${entry.name}=${formatLocalValue(value)} ${formatSchemaComment(entry)}`
    );
    emitted.add(entry.name);
  }

  for (const [name, value] of Object.entries(values)) {
    if (emitted.has(name)) {
      continue;
    }
    if (schemaByName.has(name)) {
      continue;
    }
    lines.push(`${name}=${formatLocalValue(value)}`);
  }

  if (lines.length === 0) {
    return "";
  }

  return lines.join("\n") + "\n";
}

function formatSchemaComment(s: EnvVarSchema): string {
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

export function updateHeaderSyncDate(content: string, newDate: string): string {
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const header = parseHeader(line);
    if (header) {
      lines[i] = formatHeaderLine({
        project: header.project,
        syncDate: newDate,
      });
      break;
    }
    const trimmed = line.trim();
    if (trimmed === "") continue;
    if (trimmed.startsWith("#")) {
      const schemaComment = parseSchemaComment(line);
      if (!schemaComment) continue;
    }
    break;
  }
  return lines.join("\n");
}

export function upsertHeaderSyncDate(
  content: string,
  project: string,
  newDate: string
): string {
  if (parseEnvFile(content).header) {
    return updateHeaderSyncDate(content, newDate);
  }

  const header = formatHeaderLine({ project, syncDate: newDate });
  if (content.trim() === "") {
    return `${header}\n\n`;
  }
  return `${header}\n\n${content}`;
}

export function envContentEqualIgnoringSyncDate(
  left: string,
  right: string
): boolean {
  return (
    upsertComparableHeaderDate(left) === upsertComparableHeaderDate(right)
  );
}

function upsertComparableHeaderDate(content: string): string {
  if (!parseEnvFile(content).header) {
    return content;
  }
  return updateHeaderSyncDate(content, SYNC_DATE_PLACEHOLDER);
}

export function serializeEnvValues(values: EnvValues): string {
  return Object.entries(values)
    .map(([key, value]) => `${key}=${value}`)
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

export function setEnvValue(
  content: string,
  name: string,
  value: string
): string {
  const lines = content.split("\n");
  const idx = lines.findIndex((l) => l.startsWith(`${name}=`));
  if (idx >= 0) {
    lines[idx] = `${name}=${value}`;
  } else {
    if (lines.length > 0 && lines[lines.length - 1] === "") {
      lines[lines.length - 1] = `${name}=${value}`;
      lines.push("");
    } else {
      lines.push(`${name}=${value}`);
    }
  }
  return lines.join("\n");
}
