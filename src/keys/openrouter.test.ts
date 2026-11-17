import { expect, test } from "bun:test";
import { normalizeOpenRouterOptions } from "./openrouter";

test("a new OpenRouter key is named after the project with a $10 monthly limit unless a credit is given, and only --unlimited removes the limit", () => {
  expect(normalizeOpenRouterOptions("my-project")).toEqual({ name: "my-project", limit: 10, expiresAt: null });
  expect(normalizeOpenRouterOptions("my-project", { name: "custom", credit: 10.5, expiration: "2027-12-31T23:59:59Z" })).toEqual({
    name: "custom",
    limit: 10.5,
    expiresAt: "2027-12-31T23:59:59Z",
  });
  expect(normalizeOpenRouterOptions("my-project", { unlimited: true })).toEqual({ name: "my-project", limit: null, expiresAt: null });
});
