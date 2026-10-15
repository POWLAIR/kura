import { describe, expect, it } from "vitest";
import {
  API_KEY_PREFIX,
  apiKeyFromHeader,
  generateApiKey,
  hashApiKey,
  isApiKey,
} from "./api-key.ts";

describe("generateApiKey", () => {
  it("produit une clé préfixée, au bon format, différente à chaque appel", () => {
    const [a, b] = [generateApiKey(), generateApiKey()];
    expect(a.startsWith(API_KEY_PREFIX)).toBe(true);
    expect(isApiKey(a)).toBe(true);
    expect(a).not.toBe(b);
  });
});

describe("hashApiKey", () => {
  it("renvoie le SHA-256 en hexadécimal", async () => {
    expect(await hashApiKey("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("apiKeyFromHeader", () => {
  const key = generateApiKey();

  it.each([`Bearer ${key}`, `bearer ${key}`, `  Bearer   ${key} `])("lit « %s »", (header) => {
    expect(apiKeyFromHeader(header)).toBe(key);
  });

  it.each([
    null,
    "",
    key,
    `Basic ${key}`,
    "Bearer kura_trop-court",
    `Bearer ${key}x`,
    `Bearer ${key} autre`,
  ])("refuse %s", (header) => {
    expect(apiKeyFromHeader(header)).toBeNull();
  });
});
