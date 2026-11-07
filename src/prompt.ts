import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { EnvManagerError } from './errors';

function requireTty(hint: string): void {
  if (!process.stdin.isTTY) throw new EnvManagerError(`Non-interactive shell detected. ${hint}`);
}

async function promptLine(message: string): Promise<string> {
  const rl = createInterface({ input, output });
  try {
    return await rl.question(message);
  } finally {
    rl.close();
  }
}

export async function ask<T>(question: string, parse: (answer: string) => T | undefined, retry: string, hint: string): Promise<T> {
  requireTty(hint);
  let prompt = question;
  while (true) {
    const answer = parse((await promptLine(prompt)).trim());
    if (answer !== undefined) return answer;
    prompt = retry;
  }
}

export async function confirm(question: string, assumeYes: boolean): Promise<boolean> {
  if (assumeYes) return true;
  return ask(`${question} (Y/n): `, answer => {
    const lower = answer.toLowerCase();
    if (lower === '' || lower === 'y' || lower === 'yes') return true;
    if (lower === 'n' || lower === 'no') return false;
    return undefined;
  }, 'Please answer Y or n: ', 'Re-run with --yes to accept defaults.');
}

export async function choose(question: string, options: string[], assumeYes: boolean): Promise<number> {
  if (assumeYes) return 1;
  requireTty('Re-run with --yes to accept defaults.');
  console.log(question);
  options.forEach((option, i) => console.log(`  [${i + 1}] ${option}`));
  return ask('Choice: ', answer => {
    const choice = Number.parseInt(answer, 10);
    return choice >= 1 && choice <= options.length ? choice : undefined;
  }, 'Invalid choice. Try again: ', 'Re-run with --yes to accept defaults.');
}
