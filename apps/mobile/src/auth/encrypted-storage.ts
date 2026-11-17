import aesjs from "aes-js";

// Stockage chiffré de la session Supabase sur l'appareil (issue #56). Le jeton de session
// donne accès aux repas, séances et pesées : il n'est pas gardé en clair.
//
// - la clé (chiffrement et sceau d'intégrité) est dans le stockage sûr de l'appareil
//   (Keystore Android, via expo-secure-store) ; la session, trop grande pour lui, est
//   chiffrée puis rangée dans le stockage ordinaire (AsyncStorage), avec un sceau vérifié
//   avant tout déchiffrement ;
// - chaque écriture tire une nouvelle clé, rangée sous un nom à elle : la valeur chiffrée
//   dit quelle clé la déchiffre. L'ancienne paire reste valide jusqu'à ce que la nouvelle
//   soit complète : une écriture interrompue ne déconnecte pas ;
// - lectures et écritures passent une par une : supabase-js en lance plusieurs à la fois
//   (rafraîchissement du jeton, retour au premier plan) ;
// - une valeur illisible (clé perdue, donnée altérée, stockage sûr indisponible) est
//   effacée : l'utilisateur se reconnecte, sans erreur bloquante.
//
// Les stockages et l'aléa sont injectés : ce module se teste sans React Native.

export type KeyValueStore = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};

export type EncryptedStorageDeps = {
  secure: KeyValueStore; // petit et sûr : la clé de chiffrement
  plain: KeyValueStore; // grand et ordinaire : la session chiffrée
  randomBytes: (count: number) => Uint8Array;
};

// 32 octets pour chiffrer (AES-256-CTR), 32 pour sceller (CBC-MAC sur le texte chiffré).
const KEY_BYTES = 64;
const KEY_ID_BYTES = 8;
const BLOCK = 16;
// Marque une valeur chiffrée par ce module : une session en clair d'avant ne la porte pas.
const PREFIX = "kura2:";
// Après le préfixe : « <id de clé>:<texte chiffré>.<sceau> », en hexadécimal.
const STORED = /^([0-9a-f]{16}):([0-9a-f]*)\.([0-9a-f]{32})$/;

const hex = aesjs.utils.hex;

function isJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

// Sceau d'intégrité du texte chiffré : CBC-MAC, la longueur en premier bloc. Le chiffrement
// seul ne détecterait pas une valeur altérée.
function seal(macKey: Uint8Array, data: Uint8Array): Uint8Array {
  const padded = new Uint8Array(BLOCK + Math.ceil(data.length / BLOCK) * BLOCK);
  new DataView(padded.buffer).setUint32(BLOCK - 4, data.length);
  padded.set(data, BLOCK);
  const cbc = new aesjs.ModeOfOperation.cbc(macKey, new Uint8Array(BLOCK));
  return new Uint8Array(cbc.encrypt(padded)).slice(-BLOCK);
}

function encrypt(key: Uint8Array, value: string): string {
  const ctr = new aesjs.ModeOfOperation.ctr(key.slice(0, 32), new aesjs.Counter(1));
  const encrypted = new Uint8Array(ctr.encrypt(aesjs.utils.utf8.toBytes(value)));
  return `${hex.fromBytes(encrypted)}.${hex.fromBytes(seal(key.slice(32), encrypted))}`;
}

// Le texte d'origine, ou null si le sceau ne correspond pas (valeur altérée, mauvaise clé).
function decrypt(key: Uint8Array, encryptedHex: string, tag: string): string | null {
  if (encryptedHex.length === 0 || encryptedHex.length % 2 !== 0) return null;
  const encrypted = new Uint8Array(hex.toBytes(encryptedHex));
  if (hex.fromBytes(seal(key.slice(32), encrypted)) !== tag) return null;
  const ctr = new aesjs.ModeOfOperation.ctr(key.slice(0, 32), new aesjs.Counter(1));
  return aesjs.utils.utf8.fromBytes(ctr.decrypt(encrypted));
}

// Nom de la clé dans le stockage sûr (lettres, chiffres, « . », « - », « _ » seulement).
const keyName = (name: string, keyId: string) => `${name}.${keyId}`;

// Id de la clé d'une valeur chiffrée par ce module, ou null.
function keyIdOf(stored: string | null): string | null {
  if (!stored?.startsWith(PREFIX)) return null;
  return STORED.exec(stored.slice(PREFIX.length))?.[1] ?? null;
}

export function createEncryptedStorage({
  secure,
  plain,
  randomBytes,
}: EncryptedStorageDeps): KeyValueStore {
  // Une opération à la fois : chacune attend la fin de la précédente, réussie ou non.
  let queue: Promise<unknown> = Promise.resolve();
  function inTurn<T>(operation: () => Promise<T>): Promise<T> {
    const result = queue.then(operation, operation);
    queue = result.catch(() => undefined);
    return result;
  }

  // Effacer ne doit jamais empêcher de continuer : au pire, une clé orpheline reste.
  const forget = (store: KeyValueStore, key: string) =>
    store.removeItem(key).catch(() => undefined);

  async function write(name: string, value: string): Promise<void> {
    const previousId = keyIdOf(await plain.getItem(name).catch(() => null));
    const key = randomBytes(KEY_BYTES);
    const keyId = hex.fromBytes(randomBytes(KEY_ID_BYTES));
    // La clé d'abord, sous un nom neuf : tant que la valeur n'est pas écrite, l'ancienne
    // paire reste lisible.
    await secure.setItem(keyName(name, keyId), hex.fromBytes(key));
    await plain.setItem(name, `${PREFIX}${keyId}:${encrypt(key, value)}`);
    if (previousId !== null) await forget(secure, keyName(name, previousId));
  }

  async function erase(name: string): Promise<void> {
    const keyId = keyIdOf(await plain.getItem(name).catch(() => null));
    await forget(plain, name);
    if (keyId !== null) await forget(secure, keyName(name, keyId));
  }

  async function read(name: string): Promise<string | null> {
    const stored = await plain.getItem(name);
    if (stored === null) return null;

    if (!stored.startsWith(PREFIX)) {
      // Session en clair, écrite avant le chiffrement : relue une fois, puis chiffrée.
      if (!isJson(stored)) {
        await erase(name);
        return null;
      }
      await write(name, stored);
      return stored;
    }

    const match = STORED.exec(stored.slice(PREFIX.length));
    let value: string | null = null;
    if (match) {
      const [, keyId = "", encrypted = "", tag = ""] = match;
      // Le stockage sûr peut lever (Keystore invalidé, restauration d'une sauvegarde) :
      // c'est une clé perdue comme une autre.
      const keyHex = await secure.getItem(keyName(name, keyId)).catch(() => null);
      if (keyHex !== null && /^[0-9a-f]{128}$/.test(keyHex)) {
        value = decrypt(new Uint8Array(hex.toBytes(keyHex)), encrypted, tag);
      }
    }
    // supabase-js attend du JSON : autre chose, c'est une clé perdue ou une donnée altérée.
    if (value === null || !isJson(value)) {
      await erase(name);
      return null;
    }
    return value;
  }

  return {
    getItem: (name) => inTurn(() => read(name)),
    setItem: (name, value) => inTurn(() => write(name, value)),
    removeItem: (name) => inTurn(() => erase(name)),
  };
}
