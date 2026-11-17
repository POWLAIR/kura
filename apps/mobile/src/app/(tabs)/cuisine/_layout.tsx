import { Stack } from "expo-router/stack";
import { usePalette } from "@/theme";

// Onglet Cuisine : la liste, puis l'ajout et la modification d'un article par-dessus.
export default function KitchenLayout() {
  const palette = usePalette();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: palette.background },
        headerTintColor: palette.text,
        headerShadowVisible: false,
        headerBackTitle: "Cuisine",
        contentStyle: { backgroundColor: palette.background },
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="ajouter" options={{ title: "Ajouter un article" }} />
      <Stack.Screen name="scanner" options={{ title: "Ranger les courses" }} />
      <Stack.Screen name="[id]" options={{ title: "Modifier l'article" }} />
    </Stack>
  );
}
