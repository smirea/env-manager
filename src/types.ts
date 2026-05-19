export type SchemaType =
  | "string"
  | "int"
  | "float"
  | "bool"
  | "url"
  | "email"
  | "file";

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
  syncDate: string;
}

export interface ParsedEnvFile {
  header: EnvFileHeader | null;
  schema: EnvVarSchema[];
  rawContent: string;
}

export type EnvValues = Record<string, string>;

export interface SecretPayload {
  schema: string;
  values: string;
  // Values version; the schema version lives in the .env header.
  syncDate: string;
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
