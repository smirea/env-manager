import { createAwsAdapter, secretName } from '../aws';
import {
  upsertEnvironmentInContent,
  validateEnvironmentName,
} from '../environment';
import {
  generateLocalEnvContent,
  parseEnvFile,
  parseEnvValues,
} from '../parser';
import { normalizeProjectSecret } from '../project-secret';
import type {
  CommandContext,
  EnvironmentPayload,
  EnvValues,
  EnvVarSchema,
  SecretPayload,
} from '../types';
import { EnvManagerError } from '../types';

export interface StoredFileEntry {
  name: string;
  path: string;
  content: string | null;
}

function getStoredFilePath(
  schemaEntry: EnvVarSchema,
  values: EnvValues
): string | null {
  return values[schemaEntry.name] ?? schemaEntry.defaultValue;
}

export function collectStoredFiles(
  schema: EnvVarSchema[],
  values: EnvValues,
  storedFiles: Record<string, string> | undefined
): StoredFileEntry[] {
  const entries: StoredFileEntry[] = [];
  const seen = new Set<string>();

  for (const schemaEntry of schema) {
    if (schemaEntry.type !== 'file') continue;

    const path = getStoredFilePath(schemaEntry, values);
    const files = storedFiles ?? {};
    const hasContent = Object.prototype.hasOwnProperty.call(
      files,
      schemaEntry.name
    );

    if (path === null && !hasContent) {
      continue;
    }

    entries.push({
      name: schemaEntry.name,
      path: path ?? '(path missing)',
      content: hasContent ? files[schemaEntry.name] : null,
    });
    seen.add(schemaEntry.name);
  }

  for (const [name, content] of Object.entries(storedFiles ?? {})) {
    if (seen.has(name)) continue;
    entries.push({
      name,
      path: '(unknown path)',
      content,
    });
  }

  return entries;
}

function formatSection(title: string, body: string): string {
  return `${title}\n${body === '' ? '(empty)' : body}`;
}

function formatStoredFiles(files: StoredFileEntry[]): string {
  if (files.length === 0) {
    return '(none)';
  }

  return files
    .map((file) =>
      [
        `name: ${file.name}`,
        `path: ${file.path}`,
        'contents:',
        file.content === null
          ? '(missing stored content)'
          : file.content === ''
            ? '(empty)'
            : file.content,
      ].join('\n')
    )
    .join('\n\n');
}

function formatEnvironmentPrintOutput(
  project: string,
  environment: string,
  schemaContent: string,
  envPayload: EnvironmentPayload
): string {
  const parsed = parseEnvFile(schemaContent);
  const values = parseEnvValues(envPayload.values);
  const localEnvContent = upsertEnvironmentInContent(
    generateLocalEnvContent(parsed.schema, values, {
      project: parsed.header?.project ?? project,
      syncDate: envPayload.syncDate,
    }),
    environment
  ).trimEnd();
  const fileContent = formatStoredFiles(
    collectStoredFiles(parsed.schema, values, envPayload.files)
  );

  return [
    `project: ${project}`,
    `---- env: ${environment} ----`,
    formatSection('.env', schemaContent.trimEnd()),
    formatSection('.env.local', localEnvContent),
    formatSection('files', fileContent),
  ].join('\n\n');
}

export function formatProjectPrintOutput(
  project: string,
  payload: SecretPayload,
  options: { environment?: string } = {}
): string {
  const projectSecret = normalizeProjectSecret(payload);
  const environments = options.environment
    ? [options.environment]
    : Object.keys(projectSecret.environments).sort();

  if (environments.length === 0) {
    return [
      `project: ${project}`,
      formatSection('.env', projectSecret.schema.trimEnd()),
      formatSection('environments', ''),
    ].join('\n\n');
  }

  return environments
    .map((environment) => {
      validateEnvironmentName(environment);
      const envPayload = projectSecret.environments[environment];
      if (!envPayload) {
        throw new EnvManagerError(
          `Environment "${environment}" not found for project "${project}"`
        );
      }
      return formatEnvironmentPrintOutput(
        project,
        environment,
        projectSecret.schema,
        envPayload
      );
    })
    .join('\n\n');
}

export async function printCommand(
  ctx: CommandContext,
  options: { environment?: string } = {}
): Promise<void> {
  const aws = createAwsAdapter();
  const secret = await aws.getSecret(secretName(ctx.project));

  if (!secret) {
    throw new EnvManagerError(
      `Project "${ctx.project}" not found in AWS Secrets Manager`
    );
  }

  process.stdout.write(
    `${formatProjectPrintOutput(ctx.project, secret, options)}\n`
  );
}
