import type {
  EnvFileHeader,
  EnvVarSchema,
  EnvValues,
  ParsedEnvFile,
  SchemaType,
  Validator,
} from "./types";

export function parseHeader(line: string): EnvFileHeader | null {
  const match = line.match(/^#env-manager:\s*([^\s|]+)\s*\|\s*(.+)$/);
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
  _type: SchemaType
): Validator[] {
  if (!validatorStr.trim()) return [];

  const validators: Validator[] = [];
  const pattern = /(min|max|format)\(([^)]+)\)/g;
  let match;

  while ((match = pattern.exec(validatorStr)) !== null) {
    const [, kind, value] = match;
    if (kind === "min") {
      validators.push({ kind: "min", value: parseFloat(value) });
    } else if (kind === "max") {
      validators.push({ kind: "max", value: parseFloat(value) });
    } else if (kind === "format") {
      validators.push({ kind: "format", pattern: parseFormatRegex(value) });
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
  const typeMatch = inner.match(
    /^(optional\s+)?(string|int|float|bool|url|email)(?::(.+))?$/
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

  // Look for comment: either starts with # or has " #" somewhere
  let commentIdx = -1;
  if (rest.trimStart().startsWith("#")) {
    commentIdx = rest.indexOf("#");
  } else {
    commentIdx = rest.indexOf(" #");
    if (commentIdx !== -1) commentIdx++; // skip the space, point to #
  }

  if (commentIdx !== -1) {
    inlineComment = rest.slice(commentIdx);
    rest = rest.slice(0, commentIdx);
  }

  rest = rest.trim();
  if (rest === "") {
    value = null;
  } else if (rest.startsWith("'") && rest.endsWith("'")) {
    value = rest.slice(1, -1);
  } else if (rest.startsWith('"') && rest.endsWith('"')) {
    value = rest.slice(1, -1);
  } else {
    value = rest;
  }

  return { name, value, inlineComment };
}

export function parseEnvFile(content: string): ParsedEnvFile {
  const lines = content.split("\n");
  const schema: EnvVarSchema[] = [];
  let header: EnvFileHeader | null = null;
  let pendingSchema: {
    type: SchemaType;
    optional: boolean;
    validators: Validator[];
  } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNumber = i + 1;

    if (i === 0 || (i === 1 && !header)) {
      const h = parseHeader(line);
      if (h) {
        header = h;
        continue;
      }
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
    let value = match[2].trim();

    if (
      (value.startsWith("'") && value.endsWith("'")) ||
      (value.startsWith('"') && value.endsWith('"'))
    ) {
      value = value.slice(1, -1);
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
  lines.push(`#env-manager: ${header.project} | ${header.syncDate}`);
  lines.push("");

  for (const s of schema) {
    const schemaStr = formatSchemaComment(s);
    const value = values[s.name] ?? s.defaultValue ?? "";
    lines.push(`${s.name}=${value} ${schemaStr}`);
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
  for (let i = 0; i < Math.min(2, lines.length); i++) {
    const header = parseHeader(lines[i]);
    if (header) {
      lines[i] = `#env-manager: ${header.project} | ${newDate}`;
      break;
    }
  }
  return lines.join("\n");
}
