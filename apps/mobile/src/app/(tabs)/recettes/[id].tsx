import {
  type Availability,
  ingredientAmount,
  ingredientAvailability,
  type MicronutrientSummary,
  type RecipeView,
} from "@kura/core";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { NutritionCard } from "@/components/nutrition-card";
import { Button, Notice, SectionTitle, Tag } from "@/components/ui";
import { useInventory } from "@/inventory/use-inventory";
import { errorMessage } from "@/lib/api-error";
import { confirm } from "@/lib/confirm";
import { deleteRecipe, fetchRecipe, setFavorite } from "@/recipes/data";
import { spacing, usePalette } from "@/theme";

const AVAILABILITY_TAG: Record<Availability["status"], boolean> = {
  available: false,
  short: true,
  missing: true,
};

// Étapes numérotées : le numéro fait partie de la clé, deux étapes identiques restent deux.
const numbered = (steps: string[]) => steps.map((step, i) => ({ number: i + 1, step }));

// Fiche recette : ingrédients et ce qu'en dit le stock, étapes, valeurs par portion
// (calculées depuis food_ref), puis « J'ai cuisiné ».
export default function RecipeScreen() {
  const palette = usePalette();
  const router = useRouter();
  const id = Number(useLocalSearchParams<{ id: string }>().id);
  const inventory = useInventory();
  const [data, setData] = useState<{
    recipe: RecipeView;
    micronutrients: MicronutrientSummary;
  } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function toggleFavorite() {
    if (!data) return;
    setPending(true);
    try {
      const { recipe } = await setFavorite(data.recipe.id, !data.recipe.is_favorite);
      setData({ ...data, recipe });
    } catch (error) {
      setProblem(errorMessage(error));
    } finally {
      setPending(false);
    }
  }

  async function remove() {
    if (!data) return;
    const confirmed = await confirm(
      `Supprimer « ${data.recipe.title} » ?`,
      "La recette est supprimée. Les repas déjà cuisinés restent dans le journal.",
      "Supprimer",
    );
    if (!confirmed) return;
    setPending(true);
    try {
      await deleteRecipe(data.recipe.id);
      router.back();
    } catch (error) {
      setProblem(errorMessage(error));
      setPending(false);
    }
  }

  useFocusEffect(
    useCallback(() => {
      let current = true;
      fetchRecipe(id)
        .then((found) => current && setData(found))
        .catch((error) => current && setProblem(errorMessage(error)));
      return () => {
        current = false;
      };
    }, [id]),
  );

  if (!data) {
    return (
      <View style={[styles.content, { backgroundColor: palette.background, flex: 1 }]}>
        <View style={styles.column}>
          {problem ? (
            <Notice problem>{problem}</Notice>
          ) : (
            <ActivityIndicator color={palette.accent} />
          )}
        </View>
      </View>
    );
  }
  const { recipe, micronutrients } = data;

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      style={{ backgroundColor: palette.background }}
    >
      <View style={styles.column}>
        <Text accessibilityRole="header" style={[styles.title, { color: palette.text }]}>
          {recipe.title}
        </Text>
        <Text style={{ color: palette.textSecondary }}>
          {[
            recipe.total_minutes ? `${recipe.total_minutes} min` : null,
            `${recipe.servings} ${recipe.servings > 1 ? "portions" : "portion"}`,
            recipe.origin === "manuelle" ? "recette perso" : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </Text>

        <Button
          label="J'ai cuisiné"
          onPress={() =>
            router.push({ pathname: "/recettes/cuisiner", params: { id: String(recipe.id) } })
          }
        />
        <Button
          busy={pending}
          label={recipe.is_favorite ? "Retirer des favorites" : "Ajouter aux favorites"}
          onPress={toggleFavorite}
          variant="secondary"
        />
        {problem ? <Notice problem>{problem}</Notice> : null}

        <SectionTitle>Ingrédients</SectionTitle>
        {recipe.ingredients.map((ingredient) => {
          const availability = ingredientAvailability(ingredient, inventory.items);
          return (
            <View
              key={`${ingredient.name}-${ingredient.quantity ?? ""}-${ingredient.item_id ?? ""}`}
              style={[styles.row, { borderColor: palette.border }]}
            >
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ color: palette.text }}>{ingredient.name}</Text>
                <Text style={{ color: palette.textSecondary, fontSize: 13 }}>
                  {ingredientAmount(ingredient)}
                </Text>
              </View>
              {AVAILABILITY_TAG[availability.status] ? (
                <Tag>{availability.label}</Tag>
              ) : (
                <Text style={{ color: palette.textSecondary, fontSize: 13 }}>
                  {availability.label}
                </Text>
              )}
            </View>
          );
        })}

        <SectionTitle>Étapes</SectionTitle>
        {recipe.steps.length === 0 ? (
          <Text style={{ color: palette.textSecondary }}>Pas d'étape notée.</Text>
        ) : null}
        {numbered(recipe.steps).map(({ number, step }) => (
          <View key={`${number}. ${step}`} style={styles.step}>
            <Text style={[styles.stepNumber, { color: palette.accent }]}>{number}</Text>
            <Text style={{ color: palette.text, flex: 1, lineHeight: 22 }}>{step}</Text>
          </View>
        ))}

        {recipe.nutrition_per_portion ? (
          <>
            <SectionTitle>Par portion</SectionTitle>
            <NutritionCard
              micronutrients={micronutrients}
              nutrition={recipe.nutrition_per_portion}
            />
          </>
        ) : null}

        <Button disabled={pending} label="Supprimer la recette" onPress={remove} variant="quiet" />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, alignItems: "center" },
  column: { width: "100%", maxWidth: 720, gap: spacing.md },
  title: { fontSize: 24, fontWeight: "600" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderBottomWidth: 1,
    paddingBottom: spacing.sm,
  },
  step: { flexDirection: "row", gap: spacing.md },
  stepNumber: { fontWeight: "700", width: 20 },
});
