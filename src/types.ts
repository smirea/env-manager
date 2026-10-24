export const SCHEMA_TYPES = ["string", "int", "float", "bool", "url", "email", "file"] as const;
export type SchemaType = (typeof SCHEMA_TYPES)[number];

export type MinValidator = { kind: "min"; value: number };
export type MaxValidator = { kind: "max"; value: number };
export type FormatValidator = { kind: "format"; pattern: RegExp };
export type Validator = MinValidator | MaxValidator | FormatValidator;

export interface EnvVarSchema {
  name: string;
  type: SchemaType;
  optional: boolean;
  validators: Validator[];
  defaultValue: string | null;
  lineNumber: number;
}

export interface EnvFileHeader {
  project: string;
  version: number | null;
}

export interface ParsedEnvFile {
  header: EnvFileHeader | null;
  schema: EnvVarSchema[];
  rawContent: string;
}

export type EnvValues = Record<string, string>;

export interface OutputVersion {
  version: number;
  hash: string;
  date?: string;
}

export type OutputVersions = Record<string, OutputVersion>;

export interface EnvironmentPayload {
  values: string;
  syncDate: string;
  files?: Record<string, string>;
  outputs?: OutputVersions;
}

export interface SecretPayload {
  schema: string;
  environments?: Record<string, EnvironmentPayload>;
  values?: string;
  syncDate?: string;
  files?: Record<string, string>;
  locations?: Record<string, string>;
}

export interface CommandContext {
  project: string;
  cwd: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  coercedValues: Record<string, string | number | boolean>;
}

export interface ValidationError {
  varName: string;
  message: string;
  value: string | undefined;
}

export class EnvManagerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnvManagerError";
  }
}

export class ParseError extends EnvManagerError {
  constructor(message: string) {
    super(message);
    this.name = "ParseError";
  }
}

export class AwsError extends EnvManagerError {
  constructor(message: string) {
    super(message);
    this.name = "AwsError";
  }
}

// A distinct exit code lets callers tell "no setup" apart from a broken one.
export class NotInitializedError extends EnvManagerError {
  static readonly exitCode = 3;

  constructor(message: string) {
    super(message);
    this.name = "NotInitializedError";
  }
}
