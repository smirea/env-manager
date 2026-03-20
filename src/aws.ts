import {
  CreateSecretCommand,
  GetSecretValueCommand,
  ListSecretsCommand,
  PutSecretValueCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';
import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts';
import type { SecretPayload } from './types';
import { AwsError } from './types';

export interface AwsAdapter {
  getSecret(name: string): Promise<SecretPayload | null>;
  putSecret(name: string, payload: SecretPayload): Promise<void>;
  listSecrets(prefix: string): Promise<string[]>;
}

export function secretName(project: string): string {
  return `env-manager/${project}`;
}

function getAwsRegion(): string {
  const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION;
  if (!region) {
    throw new AwsError(
      'AWS region not configured. Set AWS_REGION or AWS_DEFAULT_REGION.'
    );
  }
  return region;
}

function getStaticCredentials():
  | {
      accessKeyId: string;
      secretAccessKey: string;
      sessionToken?: string;
    }
  | null {
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  const sessionToken = process.env.AWS_SESSION_TOKEN;

  if ((accessKeyId && !secretAccessKey) || (!accessKeyId && secretAccessKey)) {
    throw new AwsError(
      'AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY must both be set.'
    );
  }

  if (!accessKeyId || !secretAccessKey) {
    return null;
  }

  return { accessKeyId, secretAccessKey, sessionToken };
}

function formatAwsError(err: unknown): string {
  if (err && typeof err === 'object') {
    const name = (err as { name?: string }).name ?? 'UnknownError';
    const message = (err as { message?: string }).message ?? String(err);
    return `${name}: ${message}`;
  }
  return String(err);
}

function isResourceNotFound(err: unknown): boolean {
  return (
    !!err &&
    typeof err === 'object' &&
    (err as { name?: string }).name === 'ResourceNotFoundException'
  );
}

class AwsSdkAdapter implements AwsAdapter {
  private readonly secrets: SecretsManagerClient;

  constructor() {
    const region = getAwsRegion();
    const credentials = getStaticCredentials();
    this.secrets = new SecretsManagerClient({
      region,
      credentials: credentials ?? undefined,
    });
  }

  async getSecret(name: string): Promise<SecretPayload | null> {
    try {
      const result = await this.secrets.send(
        new GetSecretValueCommand({ SecretId: name })
      );
      if (!result.SecretString) {
        throw new AwsError('Secret is missing SecretString payload.');
      }
      try {
        return JSON.parse(result.SecretString) as SecretPayload;
      } catch {
        throw new AwsError(`Failed to parse secret JSON: ${result.SecretString}`);
      }
    } catch (error) {
      if (isResourceNotFound(error)) return null;
      throw new AwsError(`Failed to get secret: ${formatAwsError(error)}`);
    }
  }

  async putSecret(name: string, payload: SecretPayload): Promise<void> {
    const json = JSON.stringify(payload);
    const existing = await this.getSecret(name);

    try {
      if (existing) {
        await this.secrets.send(
          new PutSecretValueCommand({
            SecretId: name,
            SecretString: json,
          })
        );
      } else {
        await this.secrets.send(
          new CreateSecretCommand({
            Name: name,
            SecretString: json,
          })
        );
      }
    } catch (error) {
      throw new AwsError(`Failed to save secret: ${formatAwsError(error)}`);
    }
  }

  async listSecrets(prefix: string): Promise<string[]> {
    const names: string[] = [];
    let nextToken: string | undefined;

    try {
      do {
        const result = await this.secrets.send(
          new ListSecretsCommand({
            Filters: [{ Key: 'name', Values: [prefix] }],
            NextToken: nextToken,
          })
        );
        if (result.SecretList) {
          for (const secret of result.SecretList) {
            if (secret.Name && secret.Name.startsWith(prefix)) {
              names.push(secret.Name);
            }
          }
        }
        nextToken = result.NextToken;
      } while (nextToken);
    } catch (error) {
      throw new AwsError(`Failed to list secrets: ${formatAwsError(error)}`);
    }

    return names;
  }
}

export function createAwsAdapter(): AwsAdapter {
  return new AwsSdkAdapter();
}

export async function checkAwsCredentials(): Promise<void> {
  const region = getAwsRegion();
  const credentials = getStaticCredentials();
  const sts = new STSClient({ region, credentials: credentials ?? undefined });
  try {
    await sts.send(new GetCallerIdentityCommand({}));
  } catch (error) {
    throw new AwsError(
      `AWS credentials not configured. ${formatAwsError(error)}`
    );
  }
}
