import { EnvManagerError } from '../errors';
import type { CommandContext } from '../project';
import { deleteProject } from '../store';

export async function rmCommand(ctx: CommandContext): Promise<void> {
  if (!await deleteProject(ctx.project)) {
    throw new EnvManagerError(`Project "${ctx.project}" not found in AWS Secrets Manager`);
  }
  console.log(`Deleted ${ctx.project} from AWS Secrets Manager. Local files were left unchanged.`);
}
