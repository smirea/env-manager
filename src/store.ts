import { createAwsAdapter } from './aws';
import { EnvManagerError } from './errors';
import { DEFAULT_ENVIRONMENT, NAME_PATTERN, removeSelection, setHeaderVersion, validateEnvironmentName, type OutputVersions } from './metadata';
import { appendSchemaEntry, parseEnvFile, parseEnvLine, parseEnvValues, serializeEnvValues, type EnvValues } from './parser';

const GLOBAL_PROJECT = 'default';
export const GLOBAL_LABEL = 'global defaults';
const RESERVED_PROJECT_NAMES = [GLOBAL_PROJECT, 'global'];

const NAMESPACE = 'env-manager/';

export interface EnvironmentPayload {
  values: string;
  syncDate: string;
  files?: Record<string, string>;
  outputs?: OutputVersions;
}

export interface ProjectSecret {
  schema: string;
  environments: Record<string, EnvironmentPayload>;
}

export interface SecretPayload {
  schema: string;
  environments?: Record<string, EnvironmentPayload>;
  values?: string;
  syncDate?: string;
  files?: Record<string, string>;
  locations?: Record<string, string>;
}

export interface GlobalDefaults {
  values: EnvValues;
  locations: Record<string, string>;
}

let adapter: ReturnType<typeof createAwsAdapter> | undefined;

function aws() {
  return adapter ??= createAwsAdapter();
}

function secretName(project: string): string {
  return `${NAMESPACE}${project}`;
}

async function getSecret(name: string): Promise<SecretPayload | null> {
  return await aws().getSecret(name) as SecretPayload | null;
}

export function validateProjectName(project: string, command: string, options: { reserved: boolean }): void {
  if (!NAME_PATTERN.test(project)) {
    throw new EnvManagerError(`Invalid project name "${project}". Project names cannot include spaces or "|".`);
  }
  if (options.reserved && RESERVED_PROJECT_NAMES.includes(project)) {
    throw new EnvManagerError(`"${project}" is a reserved project name and cannot be used with ${command}`);
  }
}

export function canonicalSchema(content: string): string {
  return setHeaderVersion(removeSelection(content), null);
}

export function environmentNames(secret: ProjectSecret): string[] {
  return Object.keys(secret.environments).sort();
}

export async function readProject(project: string): Promise<ProjectSecret | null> {
  const payload = await getSecret(secretName(project));
  if (!payload) return null;
  return {
    schema: canonicalSchema(payload.schema),
    environments: payload.environments ?? {
      [DEFAULT_ENVIRONMENT]: {
        values: payload.values ?? '',
        syncDate: payload.syncDate ?? new Date().toISOString(),
        files: payload.files,
      },
    },
  };
}

export async function requireProject(project: string): Promise<ProjectSecret> {
  const secret = await readProject(project);
  if (!secret) throw new EnvManagerError(`Project "${project}" not found in AWS Secrets Manager`);
  return secret;
}

export function requireEnvironment(secret: ProjectSecret, project: string, environment: string): EnvironmentPayload {
  validateEnvironmentName(environment);
  const payload = Object.hasOwn(secret.environments, environment) ? secret.environments[environment] : undefined;
  if (!payload) {
    throw new EnvManagerError(`Environment "${environment}" not found for project "${project}". Available: ${environmentNames(secret).join(', ')}`);
  }
  return payload;
}

export async function writeProject(project: string, secret: ProjectSecret): Promise<void> {
  await aws().putSecret(secretName(project), {
    schema: canonicalSchema(secret.schema),
    environments: secret.environments,
  });
}

export async function deleteProject(project: string): Promise<boolean> {
  return aws().deleteSecret(secretName(project));
}

export async function listProjects(): Promise<string[]> {
  const names = await aws().listSecrets(NAMESPACE);
  return names.map(name => name.slice(NAMESPACE.length)).filter(name => name !== GLOBAL_PROJECT);
}

async function readGlobalPayload(): Promise<SecretPayload | null> {
  return getSecret(secretName(GLOBAL_PROJECT));
}

export async function readGlobals(): Promise<GlobalDefaults> {
  const payload = await readGlobalPayload();
  return { values: parseEnvValues(payload?.values ?? ''), locations: payload?.locations ?? {} };
}

export async function saveGlobalValue(name: string, value: string, schemaType: string, location?: string): Promise<void> {
  const existing = await readGlobalPayload();
  let schema = existing?.schema ?? '';
  if (parseEnvFile(schema).project === null) schema = `# env-manager: ${GLOBAL_PROJECT}\n\n${schema}`;
  if (!parseEnvFile(schema).schema.some(entry => entry.name === name)) schema = appendSchemaEntry(schema, name, schemaType);
  const values = parseEnvValues(existing?.values ?? '');
  const now = new Date().toISOString();
  const syncDate = values[name] === value ? existing?.syncDate ?? now : now;
  values[name] = value;
  await writeGlobalPayload(existing, schema, values, { ...existing?.locations, ...(location ? { [name]: location } : {}) }, syncDate);
}

export async function removeGlobalValue(name: string): Promise<boolean> {
  const existing = await readGlobalPayload();
  const values = parseEnvValues(existing?.values ?? '');
  if (!existing || !Object.hasOwn(values, name)) return false;
  delete values[name];
  const { [name]: _removed, ...locations } = existing.locations ?? {};
  const schema = existing.schema.split('\n').filter(line => parseEnvLine(line.trim())?.name !== name).join('\n');
  await writeGlobalPayload(existing, schema, values, locations, new Date().toISOString());
  return true;
}

async function writeGlobalPayload(
  existing: SecretPayload | null,
  schema: string,
  values: EnvValues,
  locations: Record<string, string>,
  syncDate: string
): Promise<void> {
  await aws().putSecret(secretName(GLOBAL_PROJECT), {
    schema,
    values: serializeEnvValues(values),
    syncDate,
    files: existing?.files,
    locations: Object.keys(locations).length > 0 ? locations : undefined,
  });
}
