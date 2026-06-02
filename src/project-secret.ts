import {
  DEFAULT_ENVIRONMENT,
  removeEnvironmentFromContent,
  validateEnvironmentName,
} from './environment';
import type { EnvironmentPayload, SecretPayload } from './types';
import { EnvManagerError } from './types';

export interface ProjectSecretPayload {
  schema: string;
  environments: Record<string, EnvironmentPayload>;
}

export function normalizeProjectSecret(
  payload: SecretPayload
): ProjectSecretPayload {
  if (payload.environments) {
    return {
      schema: removeEnvironmentFromContent(payload.schema),
      environments: payload.environments,
    };
  }

  return {
    schema: removeEnvironmentFromContent(payload.schema),
    environments: {
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
    schema: removeEnvironmentFromContent(schema),
    environments,
  };
}

export function getProjectEnvironment(
  project: string,
  payload: SecretPayload,
  environment: string
): EnvironmentPayload {
  validateEnvironmentName(environment);
  const normalized = normalizeProjectSecret(payload);
  const envPayload = normalized.environments[environment];
  if (!envPayload) {
    throw new EnvManagerError(
      `Environment "${environment}" not found for project "${project}"`
    );
  }
  return envPayload;
}

export function listProjectEnvironments(payload: SecretPayload): string[] {
  return Object.keys(normalizeProjectSecret(payload).environments).sort();
}
