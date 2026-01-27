import {
  CreateSecretCommand,
  GetSecretValueCommand,
  ListSecretsCommand,
  PutSecretValueCommand,
  ResourceNotFoundException,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import type { SecretPayload } from "./types";
import { AwsError } from "./types";

export interface AwsAdapter {
  getSecret(name: string): Promise<SecretPayload | null>;
  putSecret(name: string, payload: SecretPayload): Promise<void>;
  listSecrets(prefix: string): Promise<string[]>;
}

export function secretName(project: string): string {
  return `env-manager/${project}`;
}

export class AwsCliAdapter implements AwsAdapter {
  async getSecret(name: string): Promise<SecretPayload | null> {
    const result =
      await Bun.$`aws secretsmanager get-secret-value --secret-id ${name} --query SecretString --output text`
        .quiet()
        .nothrow();

    if (result.exitCode !== 0) {
      const stderr = result.stderr.toString();
      if (
        stderr.includes("ResourceNotFoundException") ||
        stderr.includes("Secrets Manager can't find")
      ) {
        return null;
      }
      throw new AwsError(`Failed to get secret: ${stderr}`);
    }

    try {
      return JSON.parse(result.stdout.toString().trim()) as SecretPayload;
    } catch {
      throw new AwsError(`Failed to parse secret JSON: ${result.stdout}`);
    }
  }

  async putSecret(name: string, payload: SecretPayload): Promise<void> {
    const json = JSON.stringify(payload);
    const existing = await this.getSecret(name);

    if (existing) {
      const result =
        await Bun.$`aws secretsmanager put-secret-value --secret-id ${name} --secret-string ${json}`
          .quiet()
          .nothrow();
      if (result.exitCode !== 0) {
        throw new AwsError(
          `Failed to update secret: ${result.stderr.toString()}`
        );
      }
    } else {
      const result =
        await Bun.$`aws secretsmanager create-secret --name ${name} --secret-string ${json}`
          .quiet()
          .nothrow();
      if (result.exitCode !== 0) {
        throw new AwsError(
          `Failed to create secret: ${result.stderr.toString()}`
        );
      }
    }
  }

  async listSecrets(prefix: string): Promise<string[]> {
    const result =
      await Bun.$`aws secretsmanager list-secrets --filter Key=name,Values=${prefix} --query SecretList[].Name --output json`
        .quiet()
        .nothrow();

    if (result.exitCode !== 0) {
      throw new AwsError(`Failed to list secrets: ${result.stderr.toString()}`);
    }

    try {
      const names = JSON.parse(result.stdout.toString().trim()) as string[];
      return names.filter((n) => n.startsWith(prefix));
    } catch {
      throw new AwsError(`Failed to parse secrets list: ${result.stdout}`);
    }
  }
}

export class AwsSdkAdapter implements AwsAdapter {
  private client: SecretsManagerClient;

  constructor() {
    this.client = new SecretsManagerClient({});
  }

  async getSecret(name: string): Promise<SecretPayload | null> {
    try {
      const response = await this.client.send(
        new GetSecretValueCommand({ SecretId: name })
      );
      if (!response.SecretString) {
        throw new AwsError(`Secret ${name} has no string value`);
      }
      return JSON.parse(response.SecretString) as SecretPayload;
    } catch (e) {
      if (e instanceof ResourceNotFoundException) {
        return null;
      }
      throw new AwsError(
        `Failed to get secret: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  async putSecret(name: string, payload: SecretPayload): Promise<void> {
    const json = JSON.stringify(payload);
    const existing = await this.getSecret(name);

    try {
      if (existing) {
        await this.client.send(
          new PutSecretValueCommand({
            SecretId: name,
            SecretString: json,
          })
        );
      } else {
        await this.client.send(
          new CreateSecretCommand({
            Name: name,
            SecretString: json,
          })
        );
      }
    } catch (e) {
      throw new AwsError(
        `Failed to put secret: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  async listSecrets(prefix: string): Promise<string[]> {
    try {
      const response = await this.client.send(
        new ListSecretsCommand({
          Filters: [{ Key: "name", Values: [prefix] }],
        })
      );
      return (response.SecretList ?? [])
        .map((s) => s.Name)
        .filter((n): n is string => n !== undefined && n.startsWith(prefix));
    } catch (e) {
      throw new AwsError(
        `Failed to list secrets: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }
}

export function createAwsAdapter(useSdk: boolean): AwsAdapter {
  return useSdk ? new AwsSdkAdapter() : new AwsCliAdapter();
}

export async function checkAwsCredentials(): Promise<void> {
  const result = await Bun.$`aws sts get-caller-identity`.quiet().nothrow();
  if (result.exitCode !== 0) {
    throw new AwsError(
      "AWS credentials not configured. Run: aws configure\n" +
        result.stderr.toString()
    );
  }
}
