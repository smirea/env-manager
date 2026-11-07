import { upsertSetting } from '../config';
import { FORMATS, isOutputFormat, OUTPUT_FORMATS, type OutputFormat } from '../formats';
import { EnvManagerError } from '../errors';
import { readText, writeManagedFile } from '../files';
import { formatHeader } from '../metadata';
import { parseEnvFile, parseEnvValues } from '../parser';
import { loadProject, type CommandContext, type Project } from '../project';
import { confirm } from '../prompt';
import { GLOBAL_LABEL, readGlobals, readProject, requireEnvironment } from '../store';
import { readSelection, readValues, writeSourceValues } from '../values';
import { pullEnvironment } from './down';

const TEMPLATE = `# env-manager: {{PROJECT}}

# Add your environment variables below
# Example: API_KEY= # {string:format(/^sk-/)}
`;

type InitOptions = {
  assumeYes?: boolean;
  local?: boolean;
  valuesFormat?: string;
  valuesPath?: string;
};

type Settings = { format?: OutputFormat; path?: string; local: boolean };

function parseSettings(options: InitOptions): Settings {
  if (options.valuesFormat === undefined && options.valuesPath === undefined) return { local: options.local === true };
  const format = options.valuesFormat;
  if (!format) throw new EnvManagerError('Use --values-format with --values-path.');
  if (!isOutputFormat(format)) throw new EnvManagerError(`Values format must be ${OUTPUT_FORMATS.join(' or ')}.`);
  return { format, path: options.valuesPath ?? FORMATS[format].defaultPath, local: options.local === true };
}

function applySettings(content: string, settings: Settings): string {
  let updated = content;
  if (settings.format) updated = upsertSetting(upsertSetting(updated, 'format', settings.format), 'path', settings.path!);
  return settings.local ? upsertSetting(updated, 'local', 'true') : updated;
}

async function copyGlobalDefaults(project: Project, assumeYes: boolean, restrictToNames: Set<string> | null): Promise<void> {
  const globals = await readGlobals();
  const available = Object.keys(globals.values).filter(name => globals.values[name]);
  if (available.length === 0) return;
  const candidates = restrictToNames ? available.filter(name => restrictToNames.has(name)) : available;
  if (candidates.length === 0) {
    console.log(restrictToNames?.size
      ? `\nNo overlapping keys between .env and ${GLOBAL_LABEL}.`
      : `\nNo variables declared in .env to match with ${GLOBAL_LABEL}.`);
    return;
  }

  console.log(`\nFound ${candidates.length} key(s) in ${GLOBAL_LABEL}${restrictToNames ? ' matching your .env' : ''}:`);
  for (const name of candidates) console.log(`  - ${name}`);
  console.log();

  const values = await readValues(project.root, project.values);
  let copiedAny = false;
  for (const name of candidates) {
    if (await confirm(`Use ${name} from ${GLOBAL_LABEL}?`, assumeYes) && values[name] !== globals.values[name]) {
      values[name] = globals.values[name];
      copiedAny = true;
      console.log(`  Added ${name}`);
    }
  }
  if (copiedAny) {
    await writeSourceValues(project.root, project.name, project.values, project.config.schema, values);
    console.log(`\nCopied selected keys to ${project.values.path}`);
  }
}

export async function initCommand(ctx: CommandContext, options: InitOptions = {}): Promise<void> {
  const envPath = `${ctx.cwd}/.env`;
  const settings = parseSettings(options);
  const existing = await readText(envPath);

  if (existing === null && !options.local) {
    const secret = await readProject(ctx.project);
    if (secret) {
      const project = await loadProject(ctx, applySettings(secret.schema, settings));
      const { environment } = await readSelection(project.root, project.values);
      await pullEnvironment(project, environment, requireEnvironment(secret, ctx.project, environment));
      console.log(`Downloaded .env from AWS for project "${ctx.project}" environment "${environment}"`);
      return;
    }
  }

  const adopting = existing !== null && parseEnvFile(existing).project === null;
  const base = existing === null
    ? TEMPLATE.replace('{{PROJECT}}', ctx.project)
    : adopting ? `${formatHeader('#', ctx.project, null)}\n\n${existing}` : existing;
  const project = await loadProject(ctx, applySettings(base, settings));
  await writeManagedFile(envPath, project.content);
  if (existing === null) console.log(`Created new .env template for project "${ctx.project}"`);
  else if (adopting) console.log(`Adopted existing .env as project "${ctx.project}" at ${envPath}.`);
  else console.log(`.env already exists at ${envPath}, skipping creation.`);

  if (options.local) return;
  await copyGlobalDefaults(project, options.assumeYes === true, existing === null ? null : new Set(Object.keys(parseEnvValues(existing))));
}
