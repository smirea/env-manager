import type {
  EnvValues,
  EnvVarSchema,
  ValidationError,
  ValidationResult,
  Validator,
} from "./types";
import { EnvManagerError } from "./types";

export function coerceValue(
  value: string,
  type: EnvVarSchema["type"]
): string | number | boolean {
  const trimmed = value.trim();
  switch (type) {
    case "string":
    case "url":
    case "email":
    case "file":
      return trimmed;
    case "int": {
      if (!/^[+-]?\d+$/.test(trimmed)) {
        throw new EnvManagerError(`Cannot parse "${value}" as int`);
      }
      const n = Number(trimmed);
      if (!Number.isSafeInteger(n)) {
        throw new EnvManagerError(`Cannot parse "${value}" as int`);
      }
      return n;
    }
    case "float": {
      if (!/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(trimmed)) {
        throw new EnvManagerError(`Cannot parse "${value}" as float`);
      }
      const n = Number(trimmed);
      if (!Number.isFinite(n)) {
        throw new EnvManagerError(`Cannot parse "${value}" as float`);
      }
      return n;
    }
    case "bool": {
      const lower = trimmed.toLowerCase();
      if (["true", "1", "yes", "on"].includes(lower)) return true;
      if (["false", "0", "no", "off", ""].includes(lower)) return false;
      throw new EnvManagerError(`Cannot parse "${value}" as bool`);
    }
  }
}

export function runValidators(
  value: string | number | boolean,
  validators: Validator[],
  varName: string
): ValidationError | null {
  for (const v of validators) {
    if (v.kind === "min") {
      if (typeof value !== "number") {
        return {
          varName,
          message: `min() validator requires numeric type`,
          value: String(value),
        };
      }
      if (value < v.value) {
        return {
          varName,
          message: `Value ${value} is less than min(${v.value})`,
          value: String(value),
        };
      }
    } else if (v.kind === "max") {
      if (typeof value !== "number") {
        return {
          varName,
          message: `max() validator requires numeric type`,
          value: String(value),
        };
      }
      if (value > v.value) {
        return {
          varName,
          message: `Value ${value} is greater than max(${v.value})`,
          value: String(value),
        };
      }
    } else if (v.kind === "format") {
      if (typeof value !== "string") {
        return {
          varName,
          message: `format() validator requires string type`,
          value: String(value),
        };
      }
      if (v.pattern.global || v.pattern.sticky) {
        v.pattern.lastIndex = 0;
      }
      if (!v.pattern.test(value)) {
        return {
          varName,
          message: `Value "${value}" does not match pattern ${v.pattern}`,
          value,
        };
      }
    }
  }
  return null;
}

function validateUrl(value: string, varName: string): ValidationError | null {
  try {
    new URL(value);
    return null;
  } catch {
    return {
      varName,
      message: `Value "${value}" is not a valid URL`,
      value,
    };
  }
}

function validateEmail(value: string, varName: string): ValidationError | null {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(value)) {
    return {
      varName,
      message: `Value "${value}" is not a valid email`,
      value,
    };
  }
  return null;
}

export function validateEnv(
  schema: EnvVarSchema[],
  values: EnvValues
): ValidationResult {
  const errors: ValidationError[] = [];
  const coercedValues: Record<string, string | number | boolean> = {};

  for (const s of schema) {
    const rawValue = values[s.name] ?? s.defaultValue;

    if (rawValue === null || rawValue === undefined || rawValue === "") {
      if (!s.optional) {
        errors.push({
          varName: s.name,
          message: `Required variable ${s.name} is not set`,
          value: undefined,
        });
      }
      continue;
    }

    try {
      const coerced = coerceValue(rawValue, s.type);
      coercedValues[s.name] = coerced;

      if (s.type === "url") {
        const urlError = validateUrl(rawValue, s.name);
        if (urlError) {
          errors.push(urlError);
          continue;
        }
      }

      if (s.type === "email") {
        const emailError = validateEmail(rawValue, s.name);
        if (emailError) {
          errors.push(emailError);
          continue;
        }
      }

      const validatorError = runValidators(coerced, s.validators, s.name);
      if (validatorError) {
        errors.push(validatorError);
      }
    } catch (e) {
      errors.push({
        varName: s.name,
        message: e instanceof Error ? e.message : String(e),
        value: rawValue,
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    coercedValues,
  };
}

export function assertValid(result: ValidationResult): void {
  if (!result.valid) {
    const messages = result.errors
      .map((e) => `  ${e.varName}: ${e.message}`)
      .join("\n");
    throw new EnvManagerError(`Validation failed:\n${messages}`);
  }
}
