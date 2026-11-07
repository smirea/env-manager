import { formatHeader, upsertSelection } from '../metadata';
import { FORMATS } from '../formats';
import { parseEnvFile, parseEnvValues, schemaValue, type EnvValues, type EnvVarSchema } from '../parser';
import type { CommandContext } from '../project';
import { environmentNames, requireEnvironment, requireProject, type EnvironmentPayload, type ProjectSecret } from '../store';

interface StoredFileEntry {
  name: string;
  path: string;
  content: string | null;
}

function collectStoredFiles(
  schema: EnvVarSchema[],
  values: EnvValues,
  storedFiles: Record<string, string> | undefined
): StoredFileEntry[] {
  const entries: StoredFileEntry[] = [];
  const seen = new Set<string>();

  for (const schemaEntry of schema) {
    if (schemaEntry.type !== 'file') continue;

    const path = schemaValue(schemaEntry, values);
    const files = storedFiles ?? {};
    const hasContent = Object.hasOwn(files, schemaEntry.name);

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
  const header = formatHeader('#', parsed.project ?? project, envPayload.outputs?.['.env.local']?.version ?? null);
  const localEnvContent = upsertSelection(`${header}\n\n${FORMATS.ts.render(parsed.schema, values)}`, environment).trimEnd();
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

function formatProjectPrintOutput(
  project: string,
  secret: ProjectSecret,
  options: { environment?: string } = {}
): string {
  const schema = secret.schema;
  const environments = options.environment ? [options.environment] : environmentNames(secret);

  if (environments.length === 0) {
    return [
      `project: ${project}`,
      formatSection('.env', schema.trimEnd()),
      formatSection('environments', ''),
    ].join('\n\n');
  }

  return environments
    .map((environment) => formatEnvironmentPrintOutput(
      project,
      environment,
      schema,
      requireEnvironment(secret, project, environment)
    ))
    .join('\n\n');
}

export async function printCommand(
  ctx: CommandContext,
  options: { environment?: string } = {}
): Promise<void> {
  const secret = await requireProject(ctx.project);
  process.stdout.write(
    `${formatProjectPrintOutput(ctx.project, secret, options)}\n`
  );
}
