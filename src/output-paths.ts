import { access, lstat, realpath, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { configError, EnvManagerError } from './errors';
import { readMetadata } from './metadata';

async function physicalPath(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    if (await lstat(path).catch(() => null)) throw new Error(`Broken symlink at ${path}`);
    const parent = dirname(path);
    return join(await physicalPath(parent), basename(path));
  }
}

function inside(directory: string, path: string): boolean {
  const rel = relative(directory, path);
  return rel !== '..' && !rel.startsWith(`..${sep}`) && !rel.startsWith(sep);
}

export type OutputPath = { path: string; directory: string; line: number; target?: string; source?: boolean };

export async function preflightPaths(projectRoot: string, project: string, outputs: OutputPath[]): Promise<void> {
  const file = join(projectRoot, '.env');
  const root = await realpath(projectRoot);
  const schemaPath = await physicalPath(file);
  const sourcePath = await physicalPath(outputs.find(output => output.source)!.path).catch(error => configError(file, 1, `Cannot resolve values source: ${error.message}`));
  const seen = new Set<string>();
  for (const output of outputs) {
    try {
      const directory = await physicalPath(output.directory);
      const path = await physicalPath(output.path);
      if (!inside(root, directory) || !inside(directory, path)) configError(file, output.line, `Output "${output.path}" escapes ${output.target ?? 'project'} through a symlink.`);
      const stat = await lstat(path).catch(() => null);
      if (stat && !stat.isFile()) configError(file, output.line, `Output "${output.path}" is not a regular file.`);
      let writable = stat ? path : dirname(path);
      while (!await lstat(writable).catch(() => null)) writable = dirname(writable);
      await access(writable, constants.W_OK).catch(() => configError(file, output.line, `Output "${output.path}" is not writable.`));
      if (path === schemaPath || (!output.source && path === sourcePath)) configError(file, output.line, `Output "${output.path}" would overwrite the root schema or values source.`);
      if (seen.has(path) || outputs.some(other => other !== output && inside(path, resolve(other.path)) && path !== resolve(other.path))) configError(file, output.line, `Output collision at "${output.path}".`);
      seen.add(path);
      if (stat) {
        const owner = readMetadata(await readFile(path, 'utf8'));
        const damagedChild = output.target && (owner.project || owner.target || owner.root) && (!owner.project || !owner.target || !owner.root);
        if (damagedChild || (owner.project && owner.project !== project) || (owner.target && owner.target !== output.target) || (owner.root && await physicalPath(resolve(dirname(output.path), owner.root)) !== root)) {
          configError(file, output.line, `Output "${output.path}" belongs to another project, target, or root.`);
        }
      }
    } catch (error) {
      if (error instanceof EnvManagerError) throw error;
      configError(file, output.line, `Cannot use output "${output.path}": ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
