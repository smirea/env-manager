import { describe, expect, test } from "bun:test";
import {
  OPENROUTER_DEFAULT_MONTHLY_LIMIT_USD,
  extractOpenRouterApiKey,
  isValidOpenRouterApiKey,
  normalizeOpenRouterOptions,
} from "./openrouter";

describe("openrouter key generator", () => {
  test("validates expected key format", () => {
    expect(isValidOpenRouterApiKey("sk-or-v1-abc123")).toBe(true);
    expect(isValidOpenRouterApiKey("sk-or-v1-abc_DEF-123")).toBe(true);
    expect(isValidOpenRouterApiKey("sk-or-abc123")).toBe(false);
    expect(isValidOpenRouterApiKey("sk-ant-abc123")).toBe(false);
  });

  test("extracts key from top-level payload", () => {
    expect(extractOpenRouterApiKey({ key: "sk-or-v1-top-level" })).toBe(
      "sk-or-v1-top-level"
    );
  });

  test("extracts key from nested payload", () => {
    expect(
      extractOpenRouterApiKey({ data: { key: "sk-or-v1-nested" } })
    ).toBe("sk-or-v1-nested");
  });

  test("returns null when key is missing", () => {
    expect(extractOpenRouterApiKey({})).toBeNull();
    expect(extractOpenRouterApiKey({ data: {} })).toBeNull();
  });

  test("normalizes defaults from project name", () => {
    expect(normalizeOpenRouterOptions("my-project")).toEqual({
      name: "my-project",
      limit: OPENROUTER_DEFAULT_MONTHLY_LIMIT_USD,
      expiresAt: null,
    });
  });

  test("normalizes custom key options", () => {
    expect(
      normalizeOpenRouterOptions("my-project", {
        name: "custom",
        credit: 10.5,
        expiration: "2027-12-31T23:59:59Z",
      })
    ).toEqual({
      name: "custom",
      limit: 10.5,
      expiresAt: "2027-12-31T23:59:59Z",
    });
  });

  test("rejects invalid credit", () => {
    expect(() =>
      normalizeOpenRouterOptions("my-project", { credit: -1 })
    ).toThrow();
  });

  test("allows unlimited credit", () => {
    expect(
      normalizeOpenRouterOptions("my-project", {
        unlimited: true,
      })
    ).toEqual({
      name: "my-project",
      limit: null,
      expiresAt: null,
    });
  });

  test("rejects credit and unlimited together", () => {
    expect(() =>
      normalizeOpenRouterOptions("my-project", {
        credit: 10,
        unlimited: true,
      })
    ).toThrow();
  });

  test("rejects invalid expiration format", () => {
    expect(() =>
      normalizeOpenRouterOptions("my-project", {
        expiration: "2027-12-31 23:59:59",
      })
    ).toThrow();
  });
});
