import { listProjects, readGlobals } from '../store';

export async function listCommand(): Promise<void> {
  const projects = await listProjects();
  if (projects.length === 0) {
    console.log('No projects found in env-manager namespace.');
  } else {
    console.log('Projects:');
    for (const name of projects) console.log(`  ${name}`);
  }

  const globalKeys = Object.keys((await readGlobals()).values).sort();
  console.log('');
  console.log('Global defaults:');
  if (globalKeys.length === 0) {
    console.log('  (none)');
    return;
  }
  for (const key of globalKeys) console.log(`  ${key}`);
}
