import { createAwsAdapter, secretName } from '../aws';
import type { CommandContext } from '../types';
import { EnvManagerError } from '../types';

export async function rmCommand(ctx: CommandContext): Promise<void> {
  const aws = createAwsAdapter();
  const deleted = await aws.deleteSecret(secretName(ctx.project));

  if (!deleted) {
    throw new EnvManagerError(
      `Project "${ctx.project}" not found in AWS Secrets Manager`
    );
  }

  console.log(
    `Deleted ${ctx.project} from AWS Secrets Manager. Local files were left unchanged.`
  );
}
