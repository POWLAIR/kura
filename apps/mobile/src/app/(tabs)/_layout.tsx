import { Tabs } from "expo-router/js-tabs";
import { Text } from "react-native";
import { usePalette } from "@/theme";

// Les quatre onglets de la conception (« Écrans et parcours »).
const TABS = [
  { name: "index", title: "Accueil", glyph: "🍙" },
  { name: "cuisine", title: "Cuisine", glyph: "🧺" },
  { name: "recettes", title: "Recettes", glyph: "🍳" },
  { name: "journal", title: "Journal", glyph: "📓" },
] as const;

export default function TabsLayout() {
  const palette = usePalette();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: palette.accent,
        tabBarInactiveTintColor: palette.textSecondary,
        tabBarStyle: { backgroundColor: palette.surface, borderTopColor: palette.border },
        sceneStyle: { backgroundColor: palette.background },
      }}
    >
      {TABS.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            title: tab.title,
            tabBarIcon: ({ focused }) => (
              <Text style={{ fontSize: 20, opacity: focused ? 1 : 0.55 }}>{tab.glyph}</Text>
            ),
          }}
        />
      ))}
    </Tabs>
  );
}
