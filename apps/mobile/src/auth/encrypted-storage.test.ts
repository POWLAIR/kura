import { describe, expect, it } from "vitest";
import { createEncryptedStorage, type KeyValueStore } from "./encrypted-storage";

const NAME = "sb-test-auth-token";
const SESSION = JSON.stringify({
  access_token: "jeton-d-acces-très-long".repeat(40),
  refresh_token: "jeton-de-rafraîchissement",
  user: { id: "user-a", email: "a@kura.test" },
});

function memoryStore() {
  const data = new Map<string, string>();
  const store: KeyValueStore = {
    getItem: (key) => Promise.resolve(data.get(key) ?? null),
    setItem: (key, value) => {
      data.set(key, value);
      return Promise.resolve();
    },
    removeItem: (key) => {
      data.delete(key);
      return Promise.resolve();
    },
  };
  return { data, store };
}

function setup() {
  const secure = memoryStore();
  const plain = memoryStore();
  const storage = createEncryptedStorage({
    secure: secure.store,
    plain: plain.store,
    randomBytes: (count) => crypto.getRandomValues(new Uint8Array(count)),
  });
  return { storage, secure: secure.data, plain: plain.data };
}

describe("stockage chiffré de la session", () => {
  it("relit ce qu'il a écrit, sans rien laisser en clair", async () => {
    const { storage, secure, plain } = setup();
    await storage.setItem(NAME, SESSION);

    expect(await storage.getItem(NAME)).toBe(SESSION);
    const stored = plain.get(NAME) ?? "";
    expect(stored.startsWith("kura1:")).toBe(true);
    for (const secret of ["jeton-d-acces", "jeton-de-rafra", "a@kura.test", "user-a"]) {
      expect(stored).not.toContain(secret);
    }
    // La clé seule est dans le stockage sûr : 64 octets, loin de sa limite de taille.
    expect(secure.get(NAME)).toMatch(/^[0-9a-f]{128}$/);
  });

  it("tire une nouvelle clé à chaque écriture", async () => {
    const { storage, secure, plain } = setup();
    await storage.setItem(NAME, SESSION);
    const [firstKey, firstValue] = [secure.get(NAME), plain.get(NAME)];
    await storage.setItem(NAME, SESSION);
    expect(secure.get(NAME)).not.toBe(firstKey);
    expect(plain.get(NAME)).not.toBe(firstValue);
    expect(await storage.getItem(NAME)).toBe(SESSION);
  });

  it("efface tout à la déconnexion", async () => {
    const { storage, secure, plain } = setup();
    await storage.setItem(NAME, SESSION);
    await storage.removeItem(NAME);
    expect(await storage.getItem(NAME)).toBeNull();
    expect([secure.size, plain.size]).toEqual([0, 0]);
  });

  it("renvoie null sans session", async () => {
    expect(await setup().storage.getItem(NAME)).toBeNull();
  });

  it("clé absente : la session illisible est effacée, sans erreur", async () => {
    const { storage, secure, plain } = setup();
    await storage.setItem(NAME, SESSION);
    secure.delete(NAME);
    expect(await storage.getItem(NAME)).toBeNull();
    expect(plain.has(NAME)).toBe(false);
  });

  it("valeur altérée ou clé abîmée : effacées, sans erreur", async () => {
    const altered = setup();
    await altered.storage.setItem(NAME, SESSION);
    const stored = altered.plain.get(NAME) ?? "";
    // Quatre octets changés au milieu d'une chaîne : le JSON déchiffré resterait valide.
    altered.plain.set(NAME, `${stored.slice(0, 60)}00ff00ff${stored.slice(68)}`);
    expect(await altered.storage.getItem(NAME)).toBeNull();
    expect([altered.secure.size, altered.plain.size]).toEqual([0, 0]);

    const truncated = setup();
    await truncated.storage.setItem(NAME, SESSION);
    truncated.plain.set(NAME, "kura1:pas-de-l-hexadécimal");
    expect(await truncated.storage.getItem(NAME)).toBeNull();

    const badKey = setup();
    await badKey.storage.setItem(NAME, SESSION);
    badKey.secure.set(NAME, "abc");
    expect(await badKey.storage.getItem(NAME)).toBeNull();
    expect(badKey.plain.has(NAME)).toBe(false);
  });

  it("sceau ou longueur modifiés : refusés", async () => {
    const { storage, plain } = setup();
    await storage.setItem(NAME, SESSION);
    const stored = plain.get(NAME) ?? "";
    for (const forged of [
      `${stored.slice(0, -1)}${stored.endsWith("0") ? "1" : "0"}`, // sceau
      `${stored.slice(0, 40)}${stored.slice(42)}`, // un octet en moins
      stored.replace(".", "00."), // un octet en plus
    ]) {
      plain.set(NAME, forged);
      expect(await storage.getItem(NAME)).toBeNull();
      await storage.setItem(NAME, SESSION);
    }
  });

  it("session en clair d'avant le chiffrement : relue une fois, puis chiffrée", async () => {
    const { storage, secure, plain } = setup();
    plain.set(NAME, SESSION);

    expect(await storage.getItem(NAME)).toBe(SESSION);
    expect(plain.get(NAME)?.startsWith("kura1:")).toBe(true);
    expect(secure.has(NAME)).toBe(true);
    expect(await storage.getItem(NAME)).toBe(SESSION);
  });

  it("valeur en clair qui n'est pas une session : effacée", async () => {
    const { storage, plain } = setup();
    plain.set(NAME, "n'importe quoi");
    expect(await storage.getItem(NAME)).toBeNull();
    expect(plain.has(NAME)).toBe(false);
  });
});
