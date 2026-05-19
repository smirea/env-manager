import { createAwsAdapter, secretName } from '../aws';
import {
  generateLocalEnvContent,
  parseEnvFile,
  parseEnvValues,
} from '../parser';
import type {
  CommandContext,
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

export function collectStoredFiles(payload: SecretPayload): StoredFileEntry[] {
  const parsed = parseEnvFile(payload.schema);
  const values = parseEnvValues(payload.values ?? '');
  const storedFiles = payload.files ?? {};
  const entries: StoredFileEntry[] = [];
  const seen = new Set<string>();

  for (const schemaEntry of parsed.schema) {
    if (schemaEntry.type !== 'file') continue;

    const path = getStoredFilePath(schemaEntry, values);
    const hasContent = Object.prototype.hasOwnProperty.call(
      storedFiles,
      schemaEntry.name
    );

    if (path === null && !hasContent) {
      continue;
    }

    entries.push({
      name: schemaEntry.name,
      path: path ?? '(path missing)',
      content: hasContent ? storedFiles[schemaEntry.name] : null,
    });
    seen.add(schemaEntry.name);
  }

  for (const [name, content] of Object.entries(storedFiles)) {
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

export function formatProjectPrintOutput(
  project: string,
  payload: SecretPayload
): string {
  const parsed = parseEnvFile(payload.schema);
  const values = parseEnvValues(payload.values ?? '');
  const localEnvContent = generateLocalEnvContent(parsed.schema, values, {
    project: parsed.header?.project ?? project,
    syncDate: payload.syncDate,
  }).trimEnd();
  const fileContent = formatStoredFiles(collectStoredFiles(payload));

  return [
    `project: ${project}`,
    formatSection('.env', payload.schema.trimEnd()),
    formatSection('.env.local', localEnvContent),
    formatSection('files', fileContent),
  ].join('\n\n');
}

export async function printCommand(ctx: CommandContext): Promise<void> {
  const aws = createAwsAdapter();
  const secret = await aws.getSecret(secretName(ctx.project));

  if (!secret) {
    throw new EnvManagerError(
      `Project "${ctx.project}" not found in AWS Secrets Manager`
    );
  }

  process.stdout.write(`${formatProjectPrintOutput(ctx.project, secret)}\n`);
}
