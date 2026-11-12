import { Stack } from "expo-router/stack";
import { usePalette } from "@/theme";

// Onglet Journal : la frise, puis la saisie d'un repas, d'une séance ou d'une pesée.
export default function JournalLayout() {
  const palette = usePalette();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: palette.background },
        headerTintColor: palette.text,
        headerShadowVisible: false,
        headerBackTitle: "Journal",
        contentStyle: { backgroundColor: palette.background },
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="repas" options={{ title: "Repas" }} />
      <Stack.Screen name="seance" options={{ title: "Séance" }} />
      <Stack.Screen name="pesee" options={{ title: "Pesée" }} />
    </Stack>
  );
}
