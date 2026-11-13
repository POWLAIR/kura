import { describe, expect, it } from "vitest";
import { createEncryptedStorage, type KeyValueStore } from "./encrypted-storage";

const NAME = "sb-test-auth-token";
const session = (label: string) =>
  JSON.stringify({
    access_token: `jeton-d-acces-${label}-`.repeat(40),
    refresh_token: "jeton-de-rafraîchissement",
    user: { id: "user-a", email: "a@kura.test" },
  });
const SESSION = session("un");

// Stockage en mémoire. `delay` donne une latence à chaque opération, pour entrelacer des
// appels simultanés ; `fail` fait lever la prochaine opération du nom donné.
function memoryStore(delay: () => number = () => 0) {
  const data = new Map<string, string>();
  const failing = new Set<"getItem" | "setItem" | "removeItem">();
  const run = async <T>(operation: "getItem" | "setItem" | "removeItem", action: () => T) => {
    await new Promise((resolve) => setTimeout(resolve, delay()));
    if (failing.delete(operation)) throw new Error(`${operation} indisponible`);
    return action();
  };
  const store: KeyValueStore = {
    getItem: (key) => run("getItem", () => data.get(key) ?? null),
    setItem: (key, value) => run("setItem", () => void data.set(key, value)),
    removeItem: (key) => run("removeItem", () => void data.delete(key)),
  };
  return {
    data,
    store,
    fail: (operation: "getItem" | "setItem" | "removeItem") => failing.add(operation),
  };
}

function setup(delay?: () => number) {
  const secure = memoryStore(delay);
  const plain = memoryStore(delay);
  const storage = createEncryptedStorage({
    secure: secure.store,
    plain: plain.store,
    randomBytes: (count) => crypto.getRandomValues(new Uint8Array(count)),
  });
  return { storage, secure, plain };
}

describe("stockage chiffré de la session", () => {
  it("relit ce qu'il a écrit, sans rien laisser en clair", async () => {
    const { storage, secure, plain } = setup();
    await storage.setItem(NAME, SESSION);

    expect(await storage.getItem(NAME)).toBe(SESSION);
    const stored = plain.data.get(NAME) ?? "";
    expect(stored.startsWith("kura2:")).toBe(true);
    for (const secret of ["jeton-d-acces", "jeton-de-rafra", "a@kura.test", "user-a"]) {
      expect(stored).not.toContain(secret);
    }
    // Une seule clé dans le stockage sûr : 64 octets, loin de sa limite de taille.
    expect([...secure.data.keys()]).toEqual([
      expect.stringMatching(/^sb-test-auth-token\.[0-9a-f]{16}$/),
    ]);
    expect([...secure.data.values()][0]).toMatch(/^[0-9a-f]{128}$/);
  });

  it("tire une nouvelle clé à chaque écriture et oublie l'ancienne", async () => {
    const { storage, secure, plain } = setup();
    await storage.setItem(NAME, SESSION);
    const [firstKeyName] = [...secure.data.keys()];
    const firstValue = plain.data.get(NAME);
    await storage.setItem(NAME, SESSION);
    expect([...secure.data.keys()]).toHaveLength(1);
    expect([...secure.data.keys()][0]).not.toBe(firstKeyName);
    expect(plain.data.get(NAME)).not.toBe(firstValue);
    expect(await storage.getItem(NAME)).toBe(SESSION);
  });

  it("efface tout à la déconnexion", async () => {
    const { storage, secure, plain } = setup();
    await storage.setItem(NAME, SESSION);
    await storage.removeItem(NAME);
    expect(await storage.getItem(NAME)).toBeNull();
    expect([secure.data.size, plain.data.size]).toEqual([0, 0]);
  });

  it("renvoie null sans session", async () => {
    expect(await setup().storage.getItem(NAME)).toBeNull();
  });

  it("écritures simultanées : la dernière l'emporte, la session reste lisible", async () => {
    // Latences aléatoires : sans file d'attente, la clé de l'une et la valeur de l'autre
    // se croiseraient, et la session serait effacée à la lecture suivante.
    for (let round = 0; round < 20; round++) {
      const { storage, secure } = setup(() => Math.random() * 3);
      await Promise.all([
        storage.setItem(NAME, session("a")),
        storage.setItem(NAME, session("b")),
        storage.getItem(NAME),
        storage.setItem(NAME, session("c")),
      ]);
      expect(await storage.getItem(NAME)).toBe(session("c"));
      expect(secure.data.size).toBe(1);
    }
  });

  it("écriture interrompue : l'ancienne session reste lisible", async () => {
    const { storage, plain } = setup();
    await storage.setItem(NAME, SESSION);
    // La nouvelle clé est écrite, puis l'app est tuée avant la valeur.
    plain.fail("setItem");
    await expect(storage.setItem(NAME, session("deux"))).rejects.toThrow();
    expect(await storage.getItem(NAME)).toBe(SESSION);
    // L'écriture suivante repart normalement.
    await storage.setItem(NAME, session("trois"));
    expect(await storage.getItem(NAME)).toBe(session("trois"));
  });

  it("clé absente : la session illisible est effacée, sans erreur", async () => {
    const { storage, secure, plain } = setup();
    await storage.setItem(NAME, SESSION);
    secure.data.clear();
    expect(await storage.getItem(NAME)).toBeNull();
    expect(plain.data.has(NAME)).toBe(false);
  });

  it("stockage sûr indisponible : retour à la connexion, sans exception", async () => {
    const reading = setup();
    await reading.storage.setItem(NAME, SESSION);
    reading.secure.fail("getItem");
    expect(await reading.storage.getItem(NAME)).toBeNull();
    expect(reading.plain.data.has(NAME)).toBe(false);

    // L'effacement lui-même échoue : la déconnexion aboutit quand même.
    const erasing = setup();
    await erasing.storage.setItem(NAME, SESSION);
    erasing.secure.fail("removeItem");
    await expect(erasing.storage.removeItem(NAME)).resolves.toBeUndefined();
    expect(await erasing.storage.getItem(NAME)).toBeNull();
  });

  it("valeur altérée, sceau ou longueur modifiés, clé abîmée : effacés, sans erreur", async () => {
    const forge = async (alter: (stored: string) => string) => {
      const { storage, secure, plain } = setup();
      await storage.setItem(NAME, SESSION);
      plain.data.set(NAME, alter(plain.data.get(NAME) ?? ""));
      expect(await storage.getItem(NAME)).toBeNull();
      expect([secure.data.size, plain.data.size]).toEqual([0, 0]);
    };
    // Quatre octets changés au milieu d'une chaîne : le JSON déchiffré resterait valide.
    await forge((stored) => `${stored.slice(0, 80)}00ff00ff${stored.slice(88)}`);
    await forge((stored) => `${stored.slice(0, -1)}${stored.endsWith("0") ? "1" : "0"}`); // sceau
    await forge((stored) => `${stored.slice(0, 60)}${stored.slice(62)}`); // un octet en moins
    await forge((stored) => stored.replace(".", "00.")); // un octet en plus

    const unreadable = setup();
    await unreadable.storage.setItem(NAME, SESSION);
    unreadable.plain.data.set(NAME, "kura2:pas-de-l-hexadécimal");
    expect(await unreadable.storage.getItem(NAME)).toBeNull();

    const badKey = setup();
    await badKey.storage.setItem(NAME, SESSION);
    for (const name of badKey.secure.data.keys()) badKey.secure.data.set(name, "abc");
    expect(await badKey.storage.getItem(NAME)).toBeNull();
    expect(badKey.plain.data.has(NAME)).toBe(false);
  });

  it("session en clair d'avant le chiffrement : relue une fois, puis chiffrée", async () => {
    const { storage, secure, plain } = setup();
    plain.data.set(NAME, SESSION);

    expect(await storage.getItem(NAME)).toBe(SESSION);
    expect(plain.data.get(NAME)?.startsWith("kura2:")).toBe(true);
    expect(secure.data.size).toBe(1);
    expect(await storage.getItem(NAME)).toBe(SESSION);
  });

  it("valeur en clair qui n'est pas une session : effacée", async () => {
    const { storage, plain } = setup();
    plain.data.set(NAME, "n'importe quoi");
    expect(await storage.getItem(NAME)).toBeNull();
    expect(plain.data.has(NAME)).toBe(false);
  });
});
