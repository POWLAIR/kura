import type { ReactNode } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { spacing, usePalette } from "@/theme";

// Gabarit d'un écran d'onglet : titre, texte d'introduction, contenu.
export function Screen(props: { title: string; intro?: string; children?: ReactNode }) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={{ backgroundColor: palette.background }}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.lg }]}
    >
      <View style={styles.column}>
        <Text accessibilityRole="header" style={[styles.title, { color: palette.text }]}>
          {props.title}
        </Text>
        {props.intro ? (
          <Text style={[styles.intro, { color: palette.textSecondary }]}>{props.intro}</Text>
        ) : null}
        {props.children}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, alignItems: "center" },
  column: { width: "100%", maxWidth: 720, gap: spacing.md },
  title: { fontSize: 28, fontWeight: "600" },
  intro: { fontSize: 16, lineHeight: 24 },
});
