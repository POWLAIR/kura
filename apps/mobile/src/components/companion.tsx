import { StyleSheet, View } from "react-native";
import { usePalette } from "@/theme";

// Compagnon provisoire : une forme simple, deux yeux, sans animation ni machine à états.
// Le personnage final (Rive, six états) arrive en phase 5 ; son identité reste à valider.
export function Companion() {
  const palette = usePalette();
  return (
    <View
      accessibilityLabel="Le compagnon de la cuisine"
      accessibilityRole="image"
      style={[styles.body, { backgroundColor: palette.surface, borderColor: palette.border }]}
    >
      <View style={styles.eyes}>
        <View style={[styles.eye, { backgroundColor: palette.text }]} />
        <View style={[styles.eye, { backgroundColor: palette.text }]} />
      </View>
      <View style={[styles.band, { backgroundColor: palette.accent }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    width: 96,
    height: 84,
    borderWidth: 2,
    borderTopLeftRadius: 48,
    borderTopRightRadius: 48,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  eyes: { flexDirection: "row", gap: 22, marginBottom: 14 },
  eye: { width: 8, height: 8, borderRadius: 4 },
  band: { position: "absolute", bottom: 0, width: "100%", height: 20 },
});
