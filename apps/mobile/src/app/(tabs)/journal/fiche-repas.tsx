import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { NutritionCard } from "@/components/nutrition-card";
import { Button, Notice, SectionTitle } from "@/components/ui";
import { fetchMeal, type MealDetail } from "@/journal/data";
import { callApi } from "@/lib/api";
import { errorMessage, NETWORK_MESSAGE } from "@/lib/api-error";
import { confirm } from "@/lib/confirm";
import { spacing, usePalette } from "@/theme";

const decimal = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });
const UNIT_LABELS = { g: "g", ml: "ml", piece: "pièce(s)" } as const;

// Fiche d'un repas : ses aliments tels que dits, leurs grammes quand la conversion a été
// possible, et ses valeurs calculées par la base. Un repas se corrige en le supprimant puis
// en le ressaisissant, comme avec les tools MCP : ses totaux dépendent de tous ses aliments.
export default function MealSheetScreen() {
  const palette = usePalette();
  const router = useRouter();
  const id = Number(useLocalSearchParams<{ id: string }>().id);
  const [meal, setMeal] = useState<MealDetail | null>(null);
  const [missing, setMissing] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    fetchMeal(id)
      .then((found) => {
        if (!current) return;
        if (found) setMeal(found);
        else setMissing("Ce repas n'existe plus.");
      })
      .catch(() => current && setMissing(NETWORK_MESSAGE));
    return () => {
      current = false;
    };
  }, [id]);

  async function remove() {
    if (!meal) return;
    const confirmed = await confirm(
      `Supprimer « ${meal.label} » ?`,
      "Le repas et ses aliments sont supprimés. Pour le corriger, ressaisis-le ensuite. Le stock n'est pas modifié.",
      "Supprimer",
    );
    if (!confirmed) return;
    setPending(true);
    setProblem(null);
    try {
      await callApi("delete_entry", { kind: "meal", id: meal.id });
      router.back();
    } catch (error) {
      setProblem(errorMessage(error));
      setPending(false);
    }
  }

  if (missing || !meal) {
    return (
      <View style={[styles.content, { backgroundColor: palette.background, flex: 1 }]}>
        <View style={styles.column}>
          {missing ? (
            <Notice problem>{missing}</Notice>
          ) : (
            <ActivityIndicator color={palette.accent} />
          )}
          {missing ? (
            <Button label="Retour au journal" onPress={() => router.back()} variant="secondary" />
          ) : null}
        </View>
      </View>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      style={{ backgroundColor: palette.background }}
    >
      <View style={styles.column}>
        <Text accessibilityRole="header" style={[styles.title, { color: palette.text }]}>
          {meal.label}
        </Text>
        <Text style={{ color: palette.textSecondary }}>{meal.when}</Text>

        <SectionTitle>Aliments</SectionTitle>
        {meal.items.map((item) => (
          <View
            key={item.id}
            style={[styles.item, { backgroundColor: palette.surface, borderColor: palette.border }]}
          >
            <Text style={[styles.name, { color: palette.text }]}>{item.name}</Text>
            <Text style={{ color: palette.textSecondary }}>
              {[
                item.quantity !== null && item.unit !== null
                  ? `${decimal.format(item.quantity)} ${UNIT_LABELS[item.unit]}`
                  : null,
                item.unit !== "g" && item.grams !== null ? `${decimal.format(item.grams)} g` : null,
                item.food ? `référence : ${item.food}` : "sans aliment de référence, non compté",
              ]
                .filter(Boolean)
                .join(" · ")}
            </Text>
          </View>
        ))}

        <SectionTitle>Valeurs</SectionTitle>
        <NutritionCard nutrition={meal.nutrition} micronutrients={meal.micronutrients} />

        {problem ? <Notice problem>{problem}</Notice> : null}
        <Button disabled={pending} label="Supprimer le repas" onPress={remove} variant="quiet" />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, alignItems: "center" },
  column: { width: "100%", maxWidth: 720, gap: spacing.md },
  title: { fontSize: 24, fontWeight: "600" },
  item: { borderWidth: 1, borderRadius: 12, padding: spacing.md, gap: spacing.xs },
  name: { fontSize: 16, fontWeight: "500" },
});
