import { EnvManagerError } from '../errors';
import { ENV_NAME_PATTERN } from '../parser';
import { ask } from '../prompt';
import { GLOBAL_LABEL, readGlobals, removeGlobalValue, saveGlobalValue, type GlobalDefaults } from '../store';

type GlobalEntry = { name: string; value: string; location: string };

function ensureValidName(name: string): void {
  if (!new RegExp(`^${ENV_NAME_PATTERN.source}$`, 'i').test(name)) {
    throw new EnvManagerError(`Invalid env var name "${name}". Use letters, numbers, and underscores.`);
  }
}

function entry(globals: GlobalDefaults, name: string): GlobalEntry {
  return { name, value: globals.values[name], location: globals.locations[name]?.trim() || 'unknown' };
}

function formatTable(rows: GlobalEntry[]): string {
  const headers = ['Name', 'Value', 'Location'];
  const data = rows.map((row) => [row.name, row.value, row.location]);
  const widths = headers.map((header, idx) => Math.max(header.length, ...data.map((row) => row[idx].length)));
  return [
    headers.map((header, idx) => header.padEnd(widths[idx])).join('  '),
    widths.map((width) => '-'.repeat(width)).join('  '),
    ...data.map(row => row.map((cell, idx) => cell.padEnd(widths[idx])).join('  ')),
  ].join('\n');
}

export async function globalSetCommand(input: { name: string; value: string; location?: string }): Promise<void> {
  const name = input.name.trim();
  const value = input.value.trim();
  if (!name || !value) throw new EnvManagerError('Name and value are required.');
  ensureValidName(name);
  await saveGlobalValue(name, value, 'string', input.location?.trim());
  console.log(`Saved ${name} to ${GLOBAL_LABEL}`);
}

export async function globalGetCommand(keyName?: string): Promise<void> {
  const name = keyName?.trim() || await ask('Name: ', answer => answer || undefined, 'Name (required): ', 'Provide "Name" as an argument.');
  ensureValidName(name);
  const globals = await readGlobals();
  if (!Object.hasOwn(globals.values, name)) throw new EnvManagerError(`Global key not found: ${name}`);
  console.log(formatTable([entry(globals, name)]));
}

export async function globalListCommand(): Promise<void> {
  const globals = await readGlobals();
  const names = Object.keys(globals.values).sort();
  if (names.length === 0) {
    console.log('No global defaults found.');
    return;
  }
  console.log(formatTable(names.map(name => entry(globals, name))));
}

export async function globalRmCommand(name: string): Promise<void> {
  const trimmed = name.trim();
  ensureValidName(trimmed);
  if (!await removeGlobalValue(trimmed)) throw new EnvManagerError(`Global key not found: ${trimmed}`);
  console.log(`Removed ${trimmed} from ${GLOBAL_LABEL}`);
}
