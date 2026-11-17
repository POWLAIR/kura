import { type NutritionSummary, nutritionRows } from "@kura/core";
import { StyleSheet, Text, View } from "react-native";
import { spacing, usePalette } from "@/theme";

// Les valeurs principales, telles quelles : ni objectif, ni jugement, ni couleur. Une valeur
// absente est « non renseignée », un total incomplet « au moins … ».
export function NutritionCard({ nutrition }: { nutrition: NutritionSummary }) {
  const palette = usePalette();
  return (
    <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
      {nutritionRows(nutrition).map((row) => (
        <View key={row.key} style={[styles.row, row.detail && styles.detail]}>
          <Text style={{ color: row.detail ? palette.textSecondary : palette.text }}>
            {row.label}
          </Text>
          <Text style={{ color: row.known ? palette.text : palette.textSecondary }}>
            {row.text}
          </Text>
        </View>
      ))}
      {nutrition.partial_values ? (
        <Text style={[styles.note, { color: palette.textSecondary }]}>
          Valeurs partielles : certains aliments n'ont pas pu être comptés.
        </Text>
      ) : null}
      {nutrition.incomplete.length > 0 ? (
        <Text style={[styles.note, { color: palette.textSecondary }]}>
          « Au moins » : la valeur manque pour une partie des aliments.
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 12, padding: spacing.md, gap: spacing.xs },
  row: { flexDirection: "row", justifyContent: "space-between", gap: spacing.md },
  detail: { paddingLeft: spacing.md },
  note: { fontSize: 13, lineHeight: 18, marginTop: spacing.xs },
});
