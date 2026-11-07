import {
  CreateSecretCommand,
  DeleteSecretCommand,
  GetSecretValueCommand,
  ListSecretsCommand,
  PutSecretValueCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';
import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts';
import { EnvManagerError } from './errors';

function getAwsRegion(): string {
  const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION;
  if (!region) {
    throw new EnvManagerError(
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
    throw new EnvManagerError(
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

function clientConfig() {
  return { region: getAwsRegion(), credentials: getStaticCredentials() ?? undefined };
}

class AwsSdkAdapter {
  private readonly secrets = new SecretsManagerClient(clientConfig());

  async getSecret(name: string): Promise<unknown> {
    let secretString: string | undefined;
    try {
      secretString = (await this.secrets.send(new GetSecretValueCommand({ SecretId: name }))).SecretString;
    } catch (error) {
      if (isResourceNotFound(error)) return null;
      throw new EnvManagerError(`Failed to get secret: ${formatAwsError(error)}`);
    }
    if (!secretString) throw new EnvManagerError(`Secret ${name} is missing its SecretString payload.`);
    try {
      return JSON.parse(secretString) as unknown;
    } catch {
      throw new EnvManagerError(`Secret ${name} is not valid JSON.`);
    }
  }

  async putSecret(name: string, payload: unknown): Promise<void> {
    const json = JSON.stringify(payload);
    try {
      try {
        await this.secrets.send(new PutSecretValueCommand({ SecretId: name, SecretString: json }));
      } catch (error) {
        if (!isResourceNotFound(error)) throw error;
        await this.secrets.send(new CreateSecretCommand({ Name: name, SecretString: json }));
      }
    } catch (error) {
      throw new EnvManagerError(`Failed to save secret: ${formatAwsError(error)}`);
    }
  }

  async deleteSecret(name: string): Promise<boolean> {
    try {
      await this.secrets.send(
        new DeleteSecretCommand({
          SecretId: name,
          ForceDeleteWithoutRecovery: true,
        })
      );
      return true;
    } catch (error) {
      if (isResourceNotFound(error)) return false;
      throw new EnvManagerError(`Failed to delete secret: ${formatAwsError(error)}`);
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
      throw new EnvManagerError(`Failed to list secrets: ${formatAwsError(error)}`);
    }

    return names;
  }
}

export function createAwsAdapter() {
  return new AwsSdkAdapter();
}

export async function checkAwsCredentials(): Promise<void> {
  const sts = new STSClient(clientConfig());
  try {
    await sts.send(new GetCallerIdentityCommand({}));
  } catch (error) {
    throw new EnvManagerError(
      `AWS credentials not configured. ${formatAwsError(error)}`
    );
  }
}
