import { EnvManagerError } from './errors';
import { NUMERIC_VALUE_PATTERN, schemaValue, type EnvValues, type EnvVarSchema } from './parser';

export interface ValidationError {
  varName: string;
  message: string;
}

export function coerceValue(value: string, type: EnvVarSchema['type']): string | number | boolean {
  const trimmed = value.trim();
  switch (type) {
    case 'string':
    case 'url':
    case 'email':
    case 'file':
      return trimmed;
    case 'int': {
      const n = Number(trimmed);
      if (!/^[+-]?\d+$/.test(trimmed) || !Number.isSafeInteger(n)) {
        throw new EnvManagerError(`Cannot parse "${value}" as int`);
      }
      return n;
    }
    case 'float': {
      const n = Number(trimmed);
      if (!NUMERIC_VALUE_PATTERN.test(trimmed) || !Number.isFinite(n)) {
        throw new EnvManagerError(`Cannot parse "${value}" as float`);
      }
      return n;
    }
    case 'bool': {
      const lower = trimmed.toLowerCase();
      if (['true', '1', 'yes', 'on'].includes(lower)) return true;
      if (['false', '0', 'no', 'off', ''].includes(lower)) return false;
      throw new EnvManagerError(`Cannot parse "${value}" as bool`);
    }
  }
}

export function validateValue(entry: EnvVarSchema, value: string): string | null {
  let coerced: string | number | boolean;
  try {
    coerced = coerceValue(value, entry.type);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  if (entry.type === 'url' && !URL.canParse(value)) return `Value "${value}" is not a valid URL`;
  if (entry.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return `Value "${value}" is not a valid email`;
  for (const v of entry.validators) {
    if (v.kind === 'min' && (coerced as number) < v.value) return `Value ${coerced} is less than min(${v.value})`;
    if (v.kind === 'max' && (coerced as number) > v.value) return `Value ${coerced} is greater than max(${v.value})`;
    if (v.kind === 'format') {
      v.pattern.lastIndex = 0;
      if (!v.pattern.test(coerced as string)) return `Value "${coerced}" does not match pattern ${v.pattern}`;
    }
  }
  return null;
}

export function validateEnv(schema: EnvVarSchema[], values: EnvValues): ValidationError[] {
  const errors: ValidationError[] = [];
  for (const entry of schema) {
    const value = schemaValue(entry, values);
    if (!value) {
      if (!entry.optional) errors.push({ varName: entry.name, message: `Required variable ${entry.name} is not set` });
      continue;
    }
    const message = validateValue(entry, value);
    if (message) errors.push({ varName: entry.name, message });
  }
  return errors;
}

export function assertValid(schema: EnvVarSchema[], values: EnvValues): void {
  const errors = validateEnv(schema, values);
  if (errors.length) {
    throw new EnvManagerError(`Validation failed:\n${errors.map(e => `  ${e.varName}: ${e.message}`).join('\n')}`);
  }
}
