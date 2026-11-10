import { describe, expect, it } from "vitest";
import { readEnv } from "./env";

const url = "http://127.0.0.1:54321";
const jwt = (role: string) => `e30.${btoa(JSON.stringify({ role })).replace(/=+$/, "")}.signature`;

describe("readEnv", () => {
  it("lit l'URL et la clé publique", () => {
    expect(
      readEnv({
        EXPO_PUBLIC_SUPABASE_URL: ` ${url} `,
        EXPO_PUBLIC_SUPABASE_KEY: "sb_publishable_x",
      }),
    ).toEqual({ supabaseUrl: url, supabaseKey: "sb_publishable_x" });
  });

  it("accepte une clé anon d'ancienne génération", () => {
    const key = jwt("anon");
    expect(
      readEnv({ EXPO_PUBLIC_SUPABASE_URL: url, EXPO_PUBLIC_SUPABASE_KEY: key }).supabaseKey,
    ).toBe(key);
  });

  it("refuse une variable absente ou vide", () => {
    expect(() => readEnv({ EXPO_PUBLIC_SUPABASE_URL: url })).toThrow(/à définir/);
    expect(() =>
      readEnv({ EXPO_PUBLIC_SUPABASE_URL: " ", EXPO_PUBLIC_SUPABASE_KEY: "sb_publishable_x" }),
    ).toThrow(/à définir/);
  });

  it("refuse la clé secrète et la clé service_role", () => {
    for (const key of ["sb_secret_x", jwt("service_role")]) {
      expect(() =>
        readEnv({ EXPO_PUBLIC_SUPABASE_URL: url, EXPO_PUBLIC_SUPABASE_KEY: key }),
      ).toThrow(/jamais la clé secrète/);
    }
  });
});
