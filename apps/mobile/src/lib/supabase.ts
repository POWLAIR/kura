import type { Database } from "@kura/core";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import { AppState, Platform } from "react-native";
import { readEnv } from "./env";

// Expo remplace process.env.EXPO_PUBLIC_* à la compilation : les noms doivent être écrits
// en toutes lettres, sans accès dynamique.
const env = readEnv({
  EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
  EXPO_PUBLIC_SUPABASE_KEY: process.env.EXPO_PUBLIC_SUPABASE_KEY,
});

// Client Supabase de l'app : clé publique et session de l'utilisateur, donc RLS partout.
// La session est gardée sur l'appareil (AsyncStorage, localStorage sur le web).
export const supabase = createClient<Database>(env.supabaseUrl, env.supabaseKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// Sur mobile, le jeton n'est rafraîchi que quand l'app est au premier plan.
if (Platform.OS !== "web") {
  AppState.addEventListener("change", (state) => {
    if (state === "active") supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}
