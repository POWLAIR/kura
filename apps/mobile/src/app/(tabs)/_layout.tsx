import { Tabs } from "expo-router/js-tabs";
import { Text } from "react-native";
import { useWideLayout } from "@/lib/layout";
import { usePalette } from "@/theme";

// Les quatre onglets de la conception (« Écrans et parcours »).
const TABS = [
  { name: "index", title: "Accueil", glyph: "🍙" },
  { name: "cuisine", title: "Cuisine", glyph: "🧺" },
  { name: "recettes", title: "Recettes", glyph: "🍳" },
  { name: "journal", title: "Journal", glyph: "📓" },
] as const;

// Sur grand écran, les onglets forment une colonne à gauche, avec leur nom.
export default function TabsLayout() {
  const palette = usePalette();
  const wide = useWideLayout();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarPosition: wide ? "left" : "bottom",
        tabBarVariant: wide ? "material" : "uikit",
        tabBarLabelPosition: wide ? "beside-icon" : "below-icon",
        tabBarActiveTintColor: palette.accent,
        tabBarInactiveTintColor: palette.textSecondary,
        tabBarStyle: {
          backgroundColor: palette.surface,
          borderTopColor: palette.border,
          borderRightColor: palette.border,
          // La largeur par défaut de la colonne (jusqu'à 360 px) est trop grande ici.
          ...(wide ? { width: 220, minWidth: 220 } : {}),
        },
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
