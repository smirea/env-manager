import { EnvManagerError } from "../errors";
import { ask } from "../prompt";
import type { KeyDefinition, KeyOptions } from "./index";

type OpenRouterCreateKeyResponse = {
  key?: unknown;
  data?: {
    key?: unknown;
  } | null;
  error?: {
    message?: unknown;
  } | null;
  message?: unknown;
};

const OPENROUTER_CREATE_KEY_URL = "https://openrouter.ai/api/v1/keys";
const ISO_8601_UTC_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const DEFAULT_MONTHLY_LIMIT_USD = 10;

export function isValidOpenRouterApiKey(key: string): boolean {
  return /^sk-or-v1-[a-zA-Z0-9-_]+$/.test(key);
}

export function extractOpenRouterApiKey(
  payload: OpenRouterCreateKeyResponse
): string | null {
  if (typeof payload.key === "string") {
    return payload.key;
  }
  if (payload.data && typeof payload.data.key === "string") {
    return payload.data.key;
  }
  return null;
}

function extractOpenRouterErrorMessage(
  payload: OpenRouterCreateKeyResponse
): string | null {
  if (payload.error && typeof payload.error.message === "string") {
    return payload.error.message;
  }
  if (typeof payload.message === "string") {
    return payload.message;
  }
  return null;
}

type NormalizedOpenRouterOptions = {
  name: string;
  limit: number | null;
  expiresAt: string | null;
};

export function normalizeOpenRouterOptions(
  projectName: string,
  options?: KeyOptions
): NormalizedOpenRouterOptions {
  const normalizedName = options?.name?.trim() || projectName;

  if (normalizedName.length === 0) {
    throw new EnvManagerError("OpenRouter key name cannot be empty.");
  }

  if (options?.unlimited === true && options.credit !== undefined) {
    throw new EnvManagerError(
      "OpenRouter credit and unlimited mode cannot both be set."
    );
  }

  let limit: number | null = DEFAULT_MONTHLY_LIMIT_USD;
  if (options?.unlimited === true) {
    limit = null;
  } else if (options?.credit !== undefined) {
    if (!Number.isFinite(options.credit) || options.credit < 0) {
      throw new EnvManagerError(
        "OpenRouter credit must be a non-negative number."
      );
    }
    limit = options.credit;
  }

  let expiresAt: string | null = null;
  if (options?.expiration !== undefined) {
    const expiration = options.expiration.trim();
    if (!ISO_8601_UTC_PATTERN.test(expiration) || Number.isNaN(Date.parse(expiration))) {
      throw new EnvManagerError(
        "OpenRouter expiration must be a UTC ISO-8601 timestamp, e.g. 2027-12-31T23:59:59Z."
      );
    }
    expiresAt = expiration;
  }

  return {
    name: normalizedName,
    limit,
    expiresAt,
  };
}

async function promptCreditLimit(assumeYes: boolean): Promise<Pick<KeyOptions, "credit" | "unlimited">> {
  if (assumeYes) return { credit: DEFAULT_MONTHLY_LIMIT_USD };
  return ask(
    `OpenRouter monthly credit limit in USD (default ${DEFAULT_MONTHLY_LIMIT_USD}; type "unlimited" for no limit): `,
    answer => {
      const input = answer.toLowerCase();
      if (input === "") return { credit: DEFAULT_MONTHLY_LIMIT_USD };
      if (input === "unlimited") return { unlimited: true };
      const limit = Number(input);
      return Number.isFinite(limit) && limit >= 0 ? { credit: limit } : undefined;
    },
    'Invalid value. Enter a non-negative number or "unlimited": ',
    `Re-run with --yes to use the default OpenRouter limit (${DEFAULT_MONTHLY_LIMIT_USD} USD/month), or pass --credit/--unlimited.`
  );
}

export const openRouterKey: KeyDefinition = {
  envName: "OPENROUTER_API_KEY",
  description: "OpenRouter API key for model routing",
  schemaType: "string:format(/^sk-or-v1-/)",
  acceptsOptions: true,

  validate(key: string): boolean {
    return isValidOpenRouterApiKey(key);
  },

  async resolve(projectName: string, options: KeyOptions, assumeYes: boolean): Promise<string> {
    normalizeOpenRouterOptions(projectName, options);
    const limit = options.credit === undefined && options.unlimited !== true
      ? await promptCreditLimit(assumeYes)
      : {};
    const normalized = normalizeOpenRouterOptions(projectName, { ...options, ...limit });
    // env.ts validates every variable on import; only this key needs the management key.
    const { default: env } = await import("../env");
    const response = await fetch(OPENROUTER_CREATE_KEY_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.OPENROUTER_MANAGEMENT_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: normalized.name,
        limit: normalized.limit,
        expires_at: normalized.expiresAt,
      }),
    });

    let payload: OpenRouterCreateKeyResponse = {};
    try {
      payload = (await response.json()) as OpenRouterCreateKeyResponse;
    } catch {
      if (!response.ok) {
        throw new EnvManagerError(
          `OpenRouter key creation failed with status ${response.status}.`
        );
      }
      throw new EnvManagerError("OpenRouter response was not valid JSON.");
    }

    if (!response.ok) {
      const detail = extractOpenRouterErrorMessage(payload);
      const message = detail
        ? `OpenRouter key creation failed: ${detail}`
        : `OpenRouter key creation failed with status ${response.status}.`;
      throw new EnvManagerError(message);
    }

    const key = extractOpenRouterApiKey(payload);
    if (!key) {
      throw new EnvManagerError(
        "OpenRouter key creation succeeded but no key was returned."
      );
    }
    if (!isValidOpenRouterApiKey(key)) {
      throw new EnvManagerError(
        `OpenRouter returned an invalid key format: ${key.slice(0, 20)}...`
      );
    }
    return key;
  },
};
