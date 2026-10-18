import { planGeneration, syncOutputs } from './generate';
import { writeManagedFile } from '../git-updates';
import { createAwsAdapter, secretName } from "../aws";
import {
  resolveEnvironment,
} from "../environment";
import { collectFilePayload } from "../file-sync";
import {
  envValuesEqual,
  parseEnvFile,
  parseEnvValues,
  serializeEnvValues,
  setHeaderVersion,
  upsertHeaderVersion,
} from "../parser";
import {
  createProjectSecretPayload,
  normalizeProjectSecret,
} from "../project-secret";
import type { CommandContext, SecretPayload } from "../types";
import { EnvManagerError } from "../types";
import { assertValid, validateEnv } from "../validator";
import { readValuesForConfig, resolveValuesConfig } from "../values-config";
import { versionRecordsEqual } from "../versions";

export async function upCommand(ctx: CommandContext): Promise<void> {
  const envPath = `${ctx.cwd}/.env`;

  const envFile = Bun.file(envPath);
  if (!(await envFile.exists())) {
    throw new EnvManagerError(`.env not found at ${envPath}`);
  }

  let envContent = await envFile.text();
  let envContentChanged = false;
  let parsed = parseEnvFile(envContent);

  await planGeneration(ctx, envContent);
  const aws = createAwsAdapter();
  const valuesConfig = await resolveValuesConfig(ctx, envContent);
  const environment = await resolveEnvironment(ctx.cwd, {
    valuesPath: valuesConfig.format === 'ts' ? valuesConfig.path : undefined,
  });
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

    envContent = upsertHeaderVersion(envContent, ctx.project, null);
    envContentChanged = true;
    console.log(`Added env-manager header to ${envPath}`);
    parsed = parseEnvFile(envContent);
  }

  const values = await readValuesForConfig(ctx, valuesConfig);
  assertValid(validateEnv(parsed.schema, values));

  const files = await collectFilePayload(parsed.schema, values, ctx.cwd);

  const unversionedEnvContent = setHeaderVersion(envContent, null);
  if (unversionedEnvContent !== envContent) {
    envContent = unversionedEnvContent;
    envContentChanged = true;
  }

  const schemaChanged =
    !existingProject ||
    envContent !== existingProject.schema;
  const remoteValues = parseEnvValues(existingEnvironment?.values ?? "");
  const valuesChanged =
    !existingEnvironment ||
    !envValuesEqual(values, remoteValues) ||
    !envValuesEqual(files, existingEnvironment.files ?? {});
  const outputs = await syncOutputs(ctx, envContent, existingEnvironment?.outputs);
  const changed = schemaChanged || valuesChanged
    || !versionRecordsEqual(outputs, existingEnvironment?.outputs ?? {});

  if (changed) {
    const environments = {
      ...existingProject?.environments,
      [environment]: {
        values: serializeEnvValues(values),
        syncDate: valuesChanged || !existingEnvironment ? new Date().toISOString() : existingEnvironment.syncDate,
        files: Object.keys(files).length > 0 ? files : undefined,
        outputs,
      },
    };
    const payload: SecretPayload = createProjectSecretPayload(envContent, environments);
    await aws.putSecret(secretName(ctx.project), payload);
  }

  if (envContentChanged) {
    await writeManagedFile(envPath, envContent);
  }

  console.log(
    changed
      ? `Uploaded ${ctx.project}/${environment} to AWS Secrets Manager`
      : `${ctx.project}/${environment} is already up to date`
  );
}
