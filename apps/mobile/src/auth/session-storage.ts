import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { createEncryptedStorage, type KeyValueStore } from "./encrypted-storage";

// Où supabase-js garde la session de l'utilisateur.
// - Android (et iOS) : chiffrée, la clé dans le stockage sûr de l'appareil.
// - Web : localStorage, par AsyncStorage. Un navigateur n'offre pas de stockage sûr
//   équivalent : la session y est protégée comme celle de n'importe quel site.
export const sessionStorage: KeyValueStore =
  Platform.OS === "web"
    ? AsyncStorage
    : createEncryptedStorage({
        secure: {
          getItem: (key) => SecureStore.getItemAsync(key),
          setItem: (key, value) => SecureStore.setItemAsync(key, value),
          removeItem: (key) => SecureStore.deleteItemAsync(key),
        },
        plain: AsyncStorage,
        randomBytes: (count) => Crypto.getRandomBytes(count),
      });
