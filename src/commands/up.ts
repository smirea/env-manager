import { createAwsAdapter, secretName } from "../aws";
import {
  removeEnvironmentFromContent,
  resolveEnvironment,
  upsertEnvironmentInContent,
} from "../environment";
import { collectFilePayload } from "../file-sync";
import {
  envContentEqualIgnoringSyncDate,
  envValuesEqual,
  parseEnvFile,
  parseEnvValues,
  serializeEnvValues,
  updateHeaderSyncDate,
  upsertHeaderSyncDate,
} from "../parser";
import {
  createProjectSecretPayload,
  normalizeProjectSecret,
} from "../project-secret";
import type { CommandContext, SecretPayload } from "../types";
import { EnvManagerError } from "../types";
import { assertValid, validateEnv } from "../validator";

export async function upCommand(ctx: CommandContext): Promise<void> {
  const envPath = `${ctx.cwd}/.env`;
  const localPath = `${ctx.cwd}/.env.local`;

  const envFile = Bun.file(envPath);
  if (!(await envFile.exists())) {
    throw new EnvManagerError(`.env not found at ${envPath}`);
  }

  let envContent = await envFile.text();
  let envContentChanged = false;
  let parsed = parseEnvFile(envContent);

  if (parsed.header && parsed.header.project !== ctx.project) {
    throw new EnvManagerError(
      `.env project "${parsed.header.project}" does not match --project "${ctx.project}"`
    );
  }
  const envContentWithoutEnvironment = removeEnvironmentFromContent(envContent);
  if (envContentWithoutEnvironment !== envContent) {
    envContent = envContentWithoutEnvironment;
    envContentChanged = true;
    parsed = parseEnvFile(envContent);
  }

  const aws = createAwsAdapter();
  const now = new Date().toISOString();
  const environment = await resolveEnvironment(ctx.cwd);
  const existingSecret = await aws.getSecret(secretName(ctx.project));
  const existingProject = existingSecret
    ? normalizeProjectSecret(existingSecret)
    : null;
  const existingEnvironment = existingProject?.environments[environment];

  if (!parsed.header) {
    if (existingSecret) {
      throw new EnvManagerError(
        ".env is missing env-manager header. Run: env-manager init"
      );
    }

    envContent = upsertHeaderSyncDate(envContent, ctx.project, now);
    envContentChanged = true;
    console.log(`Added env-manager header to ${envPath}`);
    parsed = parseEnvFile(envContent);
  }

  let values: Record<string, string> = {};
  const localFile = Bun.file(localPath);
  let localContent: string | null = null;
  if (await localFile.exists()) {
    localContent = await localFile.text();
    values = parseEnvValues(localContent);
  }

  const result = validateEnv(parsed.schema, values);
  assertValid(result);

  const files = await collectFilePayload(parsed.schema, values, ctx.cwd);

  const envContentForStorage = removeEnvironmentFromContent(envContent);
  let schemaForPayload = existingProject?.schema ?? envContentForStorage;
  const schemaChanged =
    !existingProject ||
    !envContentEqualIgnoringSyncDate(
      envContentForStorage,
      existingProject.schema
    );
  if (schemaChanged) {
    const updatedEnvContent = updateHeaderSyncDate(envContent, now);
    if (updatedEnvContent !== envContent) {
      envContent = updatedEnvContent;
      envContentChanged = true;
    }
    schemaForPayload = removeEnvironmentFromContent(envContent);
  }

  const remoteValues = parseEnvValues(existingEnvironment?.values ?? "");
  const valuesChanged =
    !existingEnvironment ||
    !envValuesEqual(values, remoteValues) ||
    !envValuesEqual(files, existingEnvironment.files ?? {});
  const valuesSyncDate = valuesChanged
    ? now
    : existingEnvironment?.syncDate ?? now;

  if (valuesChanged && localContent !== null) {
    const updatedLocalContent = upsertEnvironmentInContent(
      upsertHeaderSyncDate(localContent, ctx.project, valuesSyncDate),
      environment
    );
    if (updatedLocalContent !== localContent) {
      await Bun.write(localPath, updatedLocalContent);
    }
  }

  const environments = {
    ...existingProject?.environments,
    [environment]: {
      values: serializeEnvValues(values),
      syncDate: valuesSyncDate,
      files: Object.keys(files).length > 0 ? files : undefined,
    },
  };
  const payload: SecretPayload = createProjectSecretPayload(
    schemaForPayload,
    environments
  );

  await aws.putSecret(secretName(ctx.project), payload);
  if (envContentChanged) {
    await Bun.write(envPath, envContent);
  }

  console.log(
    `Uploaded ${ctx.project}/${environment} to AWS Secrets Manager`
  );
}
