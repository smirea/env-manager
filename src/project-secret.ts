import { setHeaderVersion } from './parser';
import { DEFAULT_ENVIRONMENT, removeEnvironmentFromContent } from './environment';
import type { EnvironmentPayload, SecretPayload } from './types';

export interface ProjectSecretPayload {
  schema: string;
  environments: Record<string, EnvironmentPayload>;
}

export function normalizeProjectSecret(
  payload: SecretPayload
): ProjectSecretPayload {
  return {
    schema: setHeaderVersion(removeEnvironmentFromContent(payload.schema), null),
    environments: payload.environments ?? {
      [DEFAULT_ENVIRONMENT]: {
        values: payload.values ?? '',
        syncDate: payload.syncDate ?? new Date().toISOString(),
        files: payload.files,
      },
    },
  };
}

export function createProjectSecretPayload(
  schema: string,
  environments: Record<string, EnvironmentPayload>
): SecretPayload {
  return {
    schema: setHeaderVersion(removeEnvironmentFromContent(schema), null),
    environments,
  };
}

export function listProjectEnvironments(payload: SecretPayload): string[] {
  return Object.keys(normalizeProjectSecret(payload).environments).sort();
}
