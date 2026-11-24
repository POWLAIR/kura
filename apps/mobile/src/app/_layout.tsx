import { DarkTheme, DefaultTheme, ThemeProvider } from "expo-router";
import { Stack } from "expo-router/stack";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { useColorScheme } from "react-native";
import { SessionProvider, useSession } from "@/auth/session";

SplashScreen.preventAutoHideAsync();

// Sans session, seul l'écran de connexion est accessible ; avec, seuls les onglets. L'écran
// de consentement OAuth est accessible dans les deux cas : il propose la connexion lui-même,
// sans perdre la demande en cours.
function RootStack() {
  const { session, loading } = useSession();

  useEffect(() => {
    if (!loading) SplashScreen.hideAsync();
  }, [loading]);

  if (loading) return null;
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={session !== null}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen
          name="reglages"
          options={{ headerShown: true, title: "Réglages", headerBackTitle: "Retour" }}
        />
      </Stack.Protected>
      <Stack.Protected guard={session === null}>
        <Stack.Screen name="sign-in" />
      </Stack.Protected>
      <Stack.Screen name="oauth/consent" />
    </Stack>
  );
}

export default function RootLayout() {
  const scheme = useColorScheme();
  return (
    <ThemeProvider value={scheme === "dark" ? DarkTheme : DefaultTheme}>
      <SessionProvider>
        <RootStack />
      </SessionProvider>
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}
