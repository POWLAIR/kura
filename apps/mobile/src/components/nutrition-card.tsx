import {
  type MicronutrientSummary,
  micronutrientRows,
  NUTRIENT_INFO,
  NUTRIENT_SOURCES,
  type NutritionRow,
  type NutritionSummary,
  nutritionRows,
} from "@kura/core";
import { useState } from "react";
import { Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/ui";
import { spacing, usePalette } from "@/theme";

// Les valeurs telles quelles : ni objectif, ni jugement, ni couleur. Une valeur absente est
// « non renseignée », un total incomplet « au moins … ». Les principales sont toujours
// visibles ; vitamines et minéraux se déplient. Toucher une valeur ouvre sa fiche
// « À quoi ça sert » (packages/core/src/nutrient-info.ts).
export function NutritionCard({
  nutrition,
  micronutrients,
}: {
  nutrition: NutritionSummary;
  micronutrients?: MicronutrientSummary;
}) {
  const palette = usePalette();
  const [expanded, setExpanded] = useState(false);
  const [open, setOpen] = useState<NutritionRow | null>(null);

  const row = (r: NutritionRow) => (
    <Pressable
      key={r.key}
      accessibilityRole="button"
      accessibilityHint="Ouvre la fiche « À quoi ça sert »"
      onPress={() => setOpen(r)}
      style={({ pressed }) => [styles.row, r.detail && styles.detail, pressed && { opacity: 0.6 }]}
    >
      <Text style={{ color: r.detail ? palette.textSecondary : palette.text }}>{r.label}</Text>
      <Text style={{ color: r.known ? palette.text : palette.textSecondary }}>{r.text}</Text>
    </Pressable>
  );

  return (
    <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
      {nutritionRows(nutrition).map(row)}
      {micronutrients ? (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded }}
            onPress={() => setExpanded(!expanded)}
            style={[styles.toggle, { borderTopColor: palette.border }]}
          >
            <Text style={{ color: palette.accent, fontWeight: "600" }}>
              {expanded ? "Masquer les vitamines et minéraux" : "Vitamines et minéraux"}
            </Text>
          </Pressable>
          {expanded ? micronutrientRows(micronutrients).map(row) : null}
        </>
      ) : null}
      {nutrition.partial_values ? (
        <Text style={[styles.note, { color: palette.textSecondary }]}>
          Valeurs partielles : certains aliments n'ont pas pu être comptés.
        </Text>
      ) : null}
      {nutrition.incomplete.length > 0 || (micronutrients?.incomplete.length ?? 0) > 0 ? (
        <Text style={[styles.note, { color: palette.textSecondary }]}>
          « Au moins » : la valeur manque pour une partie des aliments.
        </Text>
      ) : null}
      <Text style={[styles.note, { color: palette.textSecondary }]}>
        Touche une valeur pour savoir à quoi elle sert.
      </Text>
      <NutrientSheet row={open} onClose={() => setOpen(null)} />
    </View>
  );
}

// Fiche d'une valeur : son rôle en deux ou trois phrases, et ses sources.
function NutrientSheet({ row, onClose }: { row: NutritionRow | null; onClose: () => void }) {
  const palette = usePalette();
  const info = row ? NUTRIENT_INFO[row.key] : null;
  return (
    <Modal visible={row !== null} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Fermer">
        <Pressable
          style={[styles.sheet, { backgroundColor: palette.surface, borderColor: palette.border }]}
          onPress={() => {}}
        >
          {row && info ? (
            <ScrollView contentContainerStyle={{ gap: spacing.sm }}>
              <Text accessibilityRole="header" style={[styles.title, { color: palette.text }]}>
                {row.label.replace(/^dont /, "")}
              </Text>
              <Text style={{ color: palette.text, lineHeight: 22 }}>{info.text}</Text>
              <Text style={[styles.note, { color: palette.textSecondary }]}>Sources :</Text>
              {info.sources.map((key) => (
                <Text
                  key={key}
                  accessibilityRole="link"
                  onPress={() => Linking.openURL(NUTRIENT_SOURCES[key].url)}
                  style={[styles.note, { color: palette.accent }]}
                >
                  {NUTRIENT_SOURCES[key].label}
                </Text>
              ))}
              <Button label="Fermer" variant="secondary" onPress={onClose} />
            </ScrollView>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 12, padding: spacing.md, gap: spacing.xs },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.md,
    paddingVertical: 2,
  },
  detail: { paddingLeft: spacing.md },
  toggle: { borderTopWidth: 1, marginTop: spacing.xs, paddingTop: spacing.sm },
  note: { fontSize: 13, lineHeight: 18, marginTop: spacing.xs },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    padding: spacing.md,
  },
  sheet: {
    borderWidth: 1,
    borderRadius: 16,
    padding: spacing.lg,
    maxWidth: 480,
    width: "100%",
    alignSelf: "center",
    maxHeight: "80%",
  },
  title: { fontSize: 18, fontWeight: "700" },
});
