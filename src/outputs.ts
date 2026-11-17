import { chmod } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { schemaForTarget, targetPaths, type RootConfig } from './config';
import { configError } from './errors';
import { FORMATS, type OutputFormat } from './formats';
import { readText, writeManagedFile } from './files';
import { formatHeader, formatOwnership, metadataLines, readMetadata, upsertSourceMetadata, type CommentPrefix, type OutputVersion, type OutputVersions } from './metadata';
import type { OutputPath } from './output-paths';
import { envValuesEqual, parseEnvLine, parseEnvValues, schemaValue, selectValues, type EnvValues, type EnvVarSchema } from './parser';
import type { Project } from './project';
import { READERS } from './readers';
import { assertValid, validateValue } from './validator';
import { readSelection, readValues, renderSourceValues, type ValuesConfig } from './values';

export const OVERRIDE_FILE = '.env.override';

export type PlannedOutput = OutputPath & { schema: EnvVarSchema[]; kind: 'reader' | 'values'; format: OutputFormat };

export function planOutputs(root: string, config: RootConfig, values: ValuesConfig): PlannedOutput[] {
  const outputs: PlannedOutput[] = [];
  for (const target of config.targets) {
    const { directory, values: path, reader } = targetPaths(root, target);
    const schema = schemaForTarget(config, target.name);
    outputs.push({ path, directory, line: target.line, target: target.name, schema, kind: 'values', format: target.format });
    if (reader) outputs.push({ path: reader, directory, line: target.line, target: target.name, schema, kind: 'reader', format: target.format });
  }
  outputs.push({ path: join(root, values.path), directory: root, line: 1, source: true, schema: config.schema, kind: 'values', format: values.format });
  const reader = config.targets.length ? null : config.generate ?? (config.modern ? READERS[values.format].defaultPath : null);
  if (reader) outputs.push({ path: join(root, reader), directory: root, line: 1, schema: config.schema, kind: 'reader', format: values.format });
  return outputs;
}

function hashContent(content: string): string {
  return new Bun.CryptoHasher('sha256').update(content).digest('hex').slice(0, 16);
}

// Versions label content, so two records that hold the same content are equal whatever their labels say.
export function sameOutputs(left: OutputVersions, right: OutputVersions): boolean {
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(key => left[key].hash === right[key]?.hash);
}

// A known version for this content is reused, so a hand edit heals to the label it had. Anything
// else is new content and takes the next number.
function resolveVersion(key: string, hash: string, candidates: (OutputVersions | undefined)[], fileVersion: number | null): OutputVersion {
  const entries = candidates.map(c => c?.[key]).filter((e): e is OutputVersion => !!e);
  const match = entries.filter(e => e.hash === hash).sort((a, b) => b.version - a.version)[0];
  if (match) return match;
  return { version: Math.max(fileVersion ?? 0, ...entries.map(e => e.version)) + 1, hash, date: new Date().toISOString() };
}

function commentPrefix(output: PlannedOutput): CommentPrefix {
  return output.kind === 'reader' ? READERS[output.format].commentPrefix : FORMATS[output.format].commentPrefix;
}

function renderOutput(project: Project, output: PlannedOutput, values: EnvValues, environment: string, version: number | null): string {
  if (output.source) return renderSourceValues(project.name, project.values, output.schema, values, { environment });
  const content = output.kind === 'reader' ? READERS[output.format].render(output.schema) : FORMATS[output.format].render(output.schema, values);
  const preamble = output.kind === 'reader' ? READERS[output.format].preamble : '';
  if (!output.target) return `${preamble}${formatHeader(commentPrefix(output), project.name, version)}\n${content}`;
  return preamble + formatOwnership(commentPrefix(output), {
    project: project.name,
    version,
    target: output.target,
    root: relative(dirname(output.path), project.root) || '.',
    environment: output.kind === 'reader' ? null : environment,
  }) + content;
}

// Overrides only reach target children: the root values file is what `up` uploads,
// so worktree-local values like ports must never be written there.
async function readOverrides(project: Project): Promise<EnvValues> {
  const path = join(project.root, OVERRIDE_FILE);
  const content = await readText(path);
  if (content === null) return {};
  if (!project.config.targets.length) configError(path, 1, `${OVERRIDE_FILE} only applies to target outputs. Edit ${project.values.path} directly in a single-project setup.`);
  const overrides = parseEnvValues(content);
  const lines = content.split('\n');
  for (const [name, value] of Object.entries(overrides)) {
    const line = lines.findIndex(l => parseEnvLine(l.trim())?.name === name) + 1;
    const entry = project.config.schema.find(e => e.name === name);
    if (!entry) configError(path, line, `Unknown variable ${name}. Overrides must be declared in .env.`);
    const error = value === '' ? null : validateValue(entry, value);
    if (error) configError(path, line, `Invalid value for ${name}: ${error}`);
  }
  return overrides;
}

// Values files are not formatted, so they compare by parsed values and metadata lines, where
// whitespace or a comma inside a value is a real change. Versions cannot decide a match: they are
// numbered per environment, so a prod child can carry a higher version than the dev render.
function matchesRender(output: PlannedOutput, existing: string, rendered: string): boolean {
  if (output.kind === 'reader') return READERS[output.format].matches(existing, rendered);
  return metadataLines(existing).join('\n') === metadataLines(rendered).join('\n')
    && envValuesEqual(FORMATS[output.format].parse(existing), FORMATS[output.format].parse(rendered));
}

export function assertTarget(project: Project, target: string | undefined): void {
  if (target && !project.config.targets.some(t => t.name === target)) configError(project.envPath, 1, `Unknown target "${target}".`);
}

type MaterializeOptions = { target?: string; remote?: OutputVersions };

export async function materialize(project: Project, options: MaterializeOptions = {}): Promise<OutputVersions> {
  assertTarget(project, options.target);
  const values = await readValues(project.root, project.values);
  const { environment } = await readSelection(project.root, project.values);
  for (const entry of project.config.schema) {
    const value = schemaValue(entry, values);
    const error = value ? validateValue(entry, value) : null;
    if (error) configError(join(project.root, project.values.path), 1, `Invalid value for ${entry.name}: ${error}`);
  }
  const childValues = { ...values, ...await readOverrides(project) };
  const source = project.outputs.find(o => o.source)!;
  const sourceContent = await readText(source.path);
  const local = readMetadata(sourceContent ?? '').outputs;
  const candidates = [options.remote, local];
  const record: OutputVersions = {};
  for (const output of project.outputs) {
    const key = relative(project.root, output.path);
    if (local[key]) record[key] = local[key];
  }
  for (const output of project.outputs) {
    if (options.target && output.target && output.target !== options.target) continue;
    const key = relative(project.root, output.path);
    const selected = selectValues(output.schema, output.source ? values : childValues);
    const existing = output.source ? sourceContent : await readText(output.path);
    const fileVersion = existing === null ? null : readMetadata(existing).version;
    const hash = hashContent(renderOutput(project, output, selected, environment, null));
    // A file that already holds its render keeps the version it carries: the file is what git
    // shares, while the record beside it is per checkout and goes stale on every pull.
    const current = !output.source && existing !== null && fileVersion !== null
      && matchesRender(output, existing, renderOutput(project, output, selected, environment, fileVersion));
    const entry = current ? { version: fileVersion, hash } : resolveVersion(key, hash, candidates, fileVersion);
    record[key] = entry;
    if (output.source || current) continue;
    if (await writeManagedFile(output.path, renderOutput(project, output, selected, environment, entry.version))) {
      console.log(`Generated ${key}`);
    }
    if (output.kind === 'reader' && READERS[output.format].executable) await chmod(output.path, 0o755);
  }
  const sourceKey = relative(project.root, source.path);
  const base = sourceContent ?? renderOutput(project, source, selectValues(source.schema, values), environment, null);
  const written = await writeManagedFile(source.path, upsertSourceMetadata(base, commentPrefix(source), project.name, record[sourceKey].version, record));
  if (written && sourceContent === null) console.log(`Generated ${sourceKey}`);
  return record;
}

// The next plain `generate` replaces these children because their env metadata no longer
// matches its render.
export async function renderEnvironment(project: Project, environment: string, values: EnvValues, options: { target?: string } = {}): Promise<void> {
  const rendered = project.outputs
    .filter(o => !o.source && o.kind === 'values' && (!options.target || o.target === options.target))
    .map(output => {
      assertValid(output.schema, values);
      return { output, selected: selectValues(output.schema, values) };
    });
  for (const { output, selected } of rendered) {
    const existing = await readText(output.path);
    const version = existing === null ? null : readMetadata(existing).version;
    if (await writeManagedFile(output.path, renderOutput(project, output, selected, environment, version))) {
      console.log(`Generated ${relative(project.root, output.path)} from ${environment}`);
    }
  }
}
