import { createAwsAdapter, secretName, type AwsAdapter } from "../aws";
import { GLOBAL_LABEL, GLOBAL_PROJECT } from "../global";
import {
  appendSchemaEntry,
  generateEnvContent,
  parseEnvFile,
  parseEnvValues,
  serializeEnvValues,
  upsertHeaderVersion,
} from "../parser";
import type { EnvValues, SecretPayload } from "../types";
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

function ensureGlobalSchema(schema: string): string {
  const parsed = parseEnvFile(schema);
  if (parsed.header) {
    return schema;
  }
  return upsertHeaderVersion(schema, GLOBAL_PROJECT, null);
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
  if (!process.stdin.isTTY) {
    throw new EnvManagerError(
      `Non-interactive shell detected. Provide "${label}" as an argument.`
    );
  }
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

export async function readGlobalValues(aws: AwsAdapter): Promise<EnvValues> {
  const secret = await aws.getSecret(secretName(GLOBAL_PROJECT));
  return secret?.values ? parseEnvValues(secret.values) : {};
}

export async function saveGlobalValue(
  aws: AwsAdapter,
  name: string,
  value: string,
  schemaType: string,
  location?: string
): Promise<void> {
  const existing = await aws.getSecret(secretName(GLOBAL_PROJECT));
  let schema = ensureGlobalSchema(existing?.schema ?? "");
  if (!parseEnvFile(schema).schema.some((s) => s.name === name)) {
    schema = appendSchemaEntry(schema, name, schemaType);
  }
  const values = parseEnvValues(existing?.values ?? "");
  const now = new Date().toISOString();
  const syncDate = values[name] === value ? existing?.syncDate ?? now : now;
  values[name] = value;
  const locations = { ...existing?.locations, ...(location ? { [name]: location } : {}) };

  await aws.putSecret(secretName(GLOBAL_PROJECT), {
    schema,
    values: serializeEnvValues(values),
    syncDate,
    files: existing?.files,
    locations: Object.keys(locations).length > 0 ? locations : undefined,
  });
}

export async function globalSetCommand(input: {
  name: string;
  value: string;
  location?: string;
}): Promise<void> {
  const name = input.name.trim();
  const value = input.value.trim();
  if (!name || !value) {
    throw new EnvManagerError("Name and value are required.");
  }
  ensureValidName(name);

  await saveGlobalValue(createAwsAdapter(), name, value, "string", input.location?.trim());
  console.log(`Saved ${name} to ${GLOBAL_LABEL}`);
}

export async function globalGetCommand(keyName?: string): Promise<void> {
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

export async function globalListCommand(): Promise<void> {
  const aws = createAwsAdapter();
  const secret = await aws.getSecret(secretName(GLOBAL_PROJECT));
  const entries = collectGlobalEntries(secret);

  if (entries.length === 0) {
    console.log("No global defaults found.");
    return;
  }

  console.log(formatTable(entries));
}

export async function globalRmCommand(name: string): Promise<void> {
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
  const now = new Date().toISOString();
  const schemaEntryExists = parsed.schema.some((s) => s.name === trimmed);
  let schema = secret.schema;
  if (schemaEntryExists) {
    const filteredSchema = parsed.schema.filter((s) => s.name !== trimmed);
    const header = {
      project: parsed.header?.project ?? GLOBAL_PROJECT,
      version: null,
    };
    schema =
      filteredSchema.length === 0
        ? upsertHeaderVersion("", header.project, null)
        : generateEnvContent(header, filteredSchema, {});
  }

  const payload: SecretPayload = {
    schema,
    values: serializeEnvValues(values),
    syncDate: now,
    files: secret.files,
    locations: Object.keys(locations).length > 0 ? locations : undefined,
  };

  await aws.putSecret(secretName(GLOBAL_PROJECT), payload);
  console.log(`Removed ${trimmed} from ${GLOBAL_LABEL}`);
}
