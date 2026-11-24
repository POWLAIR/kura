import { Stack } from "expo-router/stack";
import { usePalette } from "@/theme";

// Onglet Recettes : la liste, puis les propositions, la fiche et « J'ai cuisiné » par-dessus.
export default function RecipesLayout() {
  const palette = usePalette();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: palette.background },
        headerTintColor: palette.text,
        headerShadowVisible: false,
        headerBackTitle: "Recettes",
        contentStyle: { backgroundColor: palette.background },
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="proposer" options={{ title: "Qu'est-ce que je mange ?" }} />
      <Stack.Screen name="[id]" options={{ title: "Recette" }} />
      <Stack.Screen name="cuisiner" options={{ title: "J'ai cuisiné" }} />
    </Stack>
  );
}
