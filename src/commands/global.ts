import { createAwsAdapter, secretName } from "../aws";
import { GLOBAL_LABEL, GLOBAL_PROJECT } from "../global";
import {
  appendSchemaEntry,
  generateEnvContent,
  parseEnvFile,
  parseEnvValues,
  updateHeaderSyncDate,
} from "../parser";
import type { CommandContext, SecretPayload } from "../types";
import { EnvManagerError } from "../types";

const ENV_VAR_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

type GlobalEntry = {
  name: string;
  value: string;
  location: string;
};

function normalizeLocation(location: string | undefined): string {
  const trimmed = location?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : "unknown";
}

function ensureValidName(name: string): void {
  if (!ENV_VAR_NAME_PATTERN.test(name)) {
    throw new EnvManagerError(
      `Invalid env var name "${name}". Use letters, numbers, and underscores.`
    );
  }
}

function ensureGlobalSchema(schema: string, now: string): string {
  const parsed = parseEnvFile(schema);
  if (parsed.header) {
    return updateHeaderSyncDate(schema, now);
  }
  const header = `#env-manager: ${GLOBAL_PROJECT} | ${now}`;
  const trimmed = schema.trim();
  if (trimmed === "") {
    return `${header}\n\n`;
  }
  return `${header}\n\n${schema}`;
}

function formatTable(rows: GlobalEntry[]): string {
  const headers = ["Name", "Value", "Location"];
  const data = rows.map((row) => [row.name, row.value, row.location]);
  const widths = headers.map((header, idx) =>
    Math.max(
      header.length,
      ...data.map((row) => row[idx].length)
    )
  );

  const lines: string[] = [];
  lines.push(
    headers.map((header, idx) => header.padEnd(widths[idx])).join("  ")
  );
  lines.push(widths.map((width) => "-".repeat(width)).join("  "));
  for (const row of data) {
    lines.push(row.map((cell, idx) => cell.padEnd(widths[idx])).join("  "));
  }

  return lines.join("\n");
}

async function promptRequired(label: string): Promise<string> {
  process.stdout.write(`${label}: `);
  for await (const line of console) {
    const value = line.trim();
    if (value !== "") {
      return value;
    }
    process.stdout.write(`${label} (required): `);
  }
  throw new EnvManagerError("No input received");
}

function collectGlobalEntries(secret: SecretPayload | null): GlobalEntry[] {
  if (!secret?.values) return [];
  const values = parseEnvValues(secret.values);
  const locations = secret.locations ?? {};
  return Object.keys(values)
    .sort()
    .map((name) => ({
      name,
      value: values[name],
      location: normalizeLocation(locations[name]),
    }));
}

export async function globalSetCommand(
  _ctx: CommandContext,
  input: { name: string; value: string; location?: string }
): Promise<void> {
  const name = input.name.trim();
  const value = input.value.trim();
  const location = input.location?.trim() ?? "";

  if (!name || !value) {
    throw new EnvManagerError("Name and value are required.");
  }

  ensureValidName(name);

  const aws = createAwsAdapter();
  const now = new Date().toISOString();
  const existing = await aws.getSecret(secretName(GLOBAL_PROJECT));

  let schema = ensureGlobalSchema(existing?.schema ?? "", now);
  const parsed = parseEnvFile(schema);
  const existsInSchema = parsed.schema.some((s) => s.name === name);
  if (!existsInSchema) {
    schema = appendSchemaEntry(schema, name, "string");
  }
  schema = updateHeaderSyncDate(schema, now);

  const values = parseEnvValues(existing?.values ?? "");
  values[name] = value;

  const locations = { ...existing?.locations };
  if (location !== "") {
    locations[name] = location;
  }

  const payload: SecretPayload = {
    schema,
    values: Object.entries(values)
      .map(([key, val]) => `${key}=${val}`)
      .join("\n"),
    syncDate: now,
    files: existing?.files,
    locations,
  };

  await aws.putSecret(secretName(GLOBAL_PROJECT), payload);
  console.log(`Saved ${name} to ${GLOBAL_LABEL}`);
}

export async function globalGetCommand(
  _ctx: CommandContext,
  keyName?: string
): Promise<void> {
  const name = keyName ? keyName.trim() : await promptRequired("Name");
  ensureValidName(name);

  const aws = createAwsAdapter();
  const secret = await aws.getSecret(secretName(GLOBAL_PROJECT));
  if (!secret?.values) {
    throw new EnvManagerError("No global defaults found.");
  }

  const values = parseEnvValues(secret.values);
  if (!Object.prototype.hasOwnProperty.call(values, name)) {
    throw new EnvManagerError(`Global key not found: ${name}`);
  }

  const location = normalizeLocation(secret.locations?.[name]);
  const output = formatTable([{ name, value: values[name], location }]);
  console.log(output);
}

export async function globalListCommand(_ctx: CommandContext): Promise<void> {
  const aws = createAwsAdapter();
  const secret = await aws.getSecret(secretName(GLOBAL_PROJECT));
  const entries = collectGlobalEntries(secret);

  if (entries.length === 0) {
    console.log("No global defaults found.");
    return;
  }

  console.log(formatTable(entries));
}

export async function globalRmCommand(
  _ctx: CommandContext,
  name: string
): Promise<void> {
  const trimmed = name.trim();
  ensureValidName(trimmed);

  const aws = createAwsAdapter();
  const secret = await aws.getSecret(secretName(GLOBAL_PROJECT));
  if (!secret?.values) {
    throw new EnvManagerError("No global defaults found.");
  }

  const values = parseEnvValues(secret.values);
  if (!Object.prototype.hasOwnProperty.call(values, trimmed)) {
    throw new EnvManagerError(`Global key not found: ${trimmed}`);
  }

  delete values[trimmed];
  const locations = { ...secret.locations };
  delete locations[trimmed];

  const parsed = parseEnvFile(secret.schema);
  const filteredSchema = parsed.schema.filter((s) => s.name !== trimmed);
  const now = new Date().toISOString();
  const header = parsed.header ?? { project: GLOBAL_PROJECT, syncDate: now };
  header.syncDate = now;

  const schema =
    filteredSchema.length === 0
      ? `#env-manager: ${header.project} | ${header.syncDate}\n\n`
      : generateEnvContent(header, filteredSchema, {});

  const payload: SecretPayload = {
    schema,
    values: Object.entries(values)
      .map(([key, val]) => `${key}=${val}`)
      .join("\n"),
    syncDate: now,
    files: secret.files,
    locations: Object.keys(locations).length > 0 ? locations : undefined,
  };

  await aws.putSecret(secretName(GLOBAL_PROJECT), payload);
  console.log(`Removed ${trimmed} from ${GLOBAL_LABEL}`);
}
