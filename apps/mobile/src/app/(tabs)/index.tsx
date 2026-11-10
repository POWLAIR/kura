import { TIMEZONE } from "@kura/core";
import { Pressable, StyleSheet, Text } from "react-native";
import { Screen } from "@/components/screen";
import { supabase } from "@/lib/supabase";
import { spacing, usePalette } from "@/theme";

// La journée est celle de Paris, comme pour get_summary.
const today = new Intl.DateTimeFormat("fr-FR", {
  timeZone: TIMEZONE,
  weekday: "long",
  day: "numeric",
  month: "long",
});

export default function HomeScreen() {
  const palette = usePalette();
  return (
    <Screen
      title="Accueil"
      intro={`Nous sommes ${today.format(new Date())}. Le résumé du jour, les produits qui périment et le compagnon arrivent ici.`}
    >
      <Pressable
        accessibilityRole="button"
        onPress={() => supabase.auth.signOut()}
        style={[styles.signOut, { borderColor: palette.border }]}
      >
        <Text style={{ color: palette.text }}>Se déconnecter</Text>
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  signOut: {
    alignSelf: "flex-start",
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
});
