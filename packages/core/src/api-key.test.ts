import { describe, expect, it } from "vitest";
import {
  API_KEY_PREFIX,
  apiKeyFromHeader,
  apiKeyFromHeaders,
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

describe("apiKeyFromHeaders", () => {
  const key = generateApiKey();

  it.each([
    [{ authorization: `Bearer ${key}` }],
    [{ "x-api-key": key }],
    [{ "X-Auth-Token": key }],
    [{ "x-auth-api-key": ` Bearer ${key} ` }],
    // Authorization mal formé, mais une clé valide dans un en-tête X-…
    [{ authorization: "Bearer autre-chose", "x-api-key": key }],
  ])("lit la clé dans %o", (init) => {
    expect(apiKeyFromHeaders(new Headers(init))).toBe(key);
  });

  it.each([
    [{}],
    [{ "x-api-key": "kura_trop-court" }],
    [{ "x-api-key": `${key} autre` }],
    [{ "x-autre-en-tete": key }],
  ])("refuse %o", (init) => {
    expect(apiKeyFromHeaders(new Headers(init))).toBeNull();
  });
});
