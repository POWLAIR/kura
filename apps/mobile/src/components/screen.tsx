import type { ReactNode } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useWideLayout } from "@/lib/layout";
import { spacing, usePalette } from "@/theme";

// Gabarit d'un écran d'onglet : titre, texte d'introduction, contenu. Sur grand écran,
// `aside` forme une seconde colonne à droite ; sinon, il suit le contenu.
export function Screen(props: {
  title: string;
  intro?: string;
  aside?: ReactNode;
  children?: ReactNode;
}) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const wide = useWideLayout();
  return (
    <ScrollView
      style={{ backgroundColor: palette.background }}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.lg }]}
    >
      <View style={[styles.column, wide && styles.wideColumn]}>
        <Text accessibilityRole="header" style={[styles.title, { color: palette.text }]}>
          {props.title}
        </Text>
        {props.intro ? (
          <Text style={[styles.intro, { color: palette.textSecondary }]}>{props.intro}</Text>
        ) : null}
        {wide && props.aside ? (
          <View style={styles.columns}>
            <View style={styles.main}>{props.children}</View>
            <View style={styles.aside}>{props.aside}</View>
          </View>
        ) : (
          <>
            {props.children}
            {props.aside}
          </>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, alignItems: "center" },
  column: { width: "100%", maxWidth: 720, gap: spacing.md },
  wideColumn: { maxWidth: 1200 },
  columns: { flexDirection: "row", alignItems: "flex-start", gap: spacing.xl },
  main: { flex: 3, minWidth: 0, gap: spacing.md },
  aside: { flex: 2, minWidth: 0, gap: spacing.md },
  title: { fontSize: 28, fontWeight: "600" },
  intro: { fontSize: 16, lineHeight: 24 },
});
