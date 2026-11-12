import aesjs from "aes-js";

// Stockage chiffré de la session Supabase sur l'appareil (issue #56). Le jeton de session
// donne accès aux repas, séances et pesées : il n'est pas gardé en clair.
//
// - la clé (chiffrement et sceau d'intégrité) est dans le stockage sûr de l'appareil
//   (Keystore Android, via expo-secure-store) ; la session, trop grande pour lui, est
//   chiffrée puis rangée dans le stockage ordinaire (AsyncStorage), avec un sceau vérifié
//   avant tout déchiffrement ;
// - chaque écriture tire une nouvelle clé : jamais deux chiffrements avec la même ;
// - une valeur illisible (clé perdue, donnée altérée) est effacée : l'utilisateur se
//   reconnecte, sans erreur bloquante.
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
const BLOCK = 16;
// Marque une valeur chiffrée par ce module : une session en clair d'avant ne la porte pas.
const PREFIX = "kura1:";

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
  const tag = seal(key.slice(32), encrypted);
  return `${PREFIX}${aesjs.utils.hex.fromBytes(encrypted)}.${aesjs.utils.hex.fromBytes(tag)}`;
}

// Le texte d'origine, ou null si le sceau ne correspond pas (valeur altérée, mauvaise clé).
function decrypt(key: Uint8Array, stored: string): string | null {
  const match = /^([0-9a-f]*)\.([0-9a-f]{32})$/.exec(stored.slice(PREFIX.length));
  if (!match?.[1] || match[1].length % 2 !== 0) return null;
  const encrypted = new Uint8Array(aesjs.utils.hex.toBytes(match[1]));
  if (aesjs.utils.hex.fromBytes(seal(key.slice(32), encrypted)) !== match[2]) return null;
  const ctr = new aesjs.ModeOfOperation.ctr(key.slice(0, 32), new aesjs.Counter(1));
  return aesjs.utils.utf8.fromBytes(ctr.decrypt(encrypted));
}

export function createEncryptedStorage({
  secure,
  plain,
  randomBytes,
}: EncryptedStorageDeps): KeyValueStore {
  async function setItem(name: string, value: string): Promise<void> {
    const key = randomBytes(KEY_BYTES);
    // La clé d'abord : une session chiffrée sans sa clé serait illisible.
    await secure.setItem(name, aesjs.utils.hex.fromBytes(key));
    await plain.setItem(name, encrypt(key, value));
  }

  async function removeItem(name: string): Promise<void> {
    await plain.removeItem(name);
    await secure.removeItem(name);
  }

  async function getItem(name: string): Promise<string | null> {
    const stored = await plain.getItem(name);
    if (stored === null) return null;

    if (!stored.startsWith(PREFIX)) {
      // Session en clair, écrite avant le chiffrement : relue une fois, puis chiffrée.
      if (!isJson(stored)) {
        await removeItem(name);
        return null;
      }
      await setItem(name, stored);
      return stored;
    }

    const keyHex = await secure.getItem(name);
    const value =
      keyHex !== null && /^[0-9a-f]{128}$/.test(keyHex)
        ? decrypt(new Uint8Array(aesjs.utils.hex.toBytes(keyHex)), stored)
        : null;
    // supabase-js attend du JSON : autre chose, c'est une clé perdue ou une donnée altérée.
    if (value === null || !isJson(value)) {
      await removeItem(name);
      return null;
    }
    return value;
  }

  return { getItem, setItem, removeItem };
}
