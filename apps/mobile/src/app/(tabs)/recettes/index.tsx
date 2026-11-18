import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Screen } from "@/components/screen";
import { Button, Notice, SectionTitle, Tag } from "@/components/ui";
import { errorMessage } from "@/lib/api-error";
import { fetchRecipes, type RecipeSummary } from "@/recipes/data";
import { spacing, usePalette } from "@/theme";

const lastCooked = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});

export function RecipeRow({ recipe }: { recipe: RecipeSummary }) {
  const palette = usePalette();
  const router = useRouter();
  const details = [
    recipe.total_minutes ? `${recipe.total_minutes} min` : null,
    `${recipe.servings} ${recipe.servings > 1 ? "portions" : "portion"}`,
    recipe.last_cooked
      ? `cuisinée le ${lastCooked.format(new Date(`${recipe.last_cooked}T00:00:00Z`))}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <Pressable
      accessibilityHint="Ouvre la recette"
      accessibilityLabel={`${recipe.title}, ${details}`}
      accessibilityRole="button"
      onPress={() => router.push({ pathname: "/recettes/[id]", params: { id: String(recipe.id) } })}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: palette.surface, borderColor: palette.border },
        pressed && { opacity: 0.8 },
      ]}
    >
      <View style={{ flex: 1, gap: spacing.xs }}>
        <Text style={[styles.title, { color: palette.text }]}>{recipe.title}</Text>
        <Text style={{ color: palette.textSecondary }}>{details}</Text>
      </View>
      {recipe.is_favorite ? <Tag>Favorite</Tag> : null}
    </Pressable>
  );
}

// Onglet Recettes : « Qu'est-ce que je mange ? », puis les recettes enregistrées.
export default function RecipesScreen() {
  const palette = usePalette();
  const router = useRouter();
  const [recipes, setRecipes] = useState<RecipeSummary[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let current = true;
      fetchRecipes()
        .then(({ recipes: found }) => {
          if (!current) return;
          setRecipes(found);
          setProblem(null);
        })
        .catch((error) => current && setProblem(errorMessage(error)));
      return () => {
        current = false;
      };
    }, []),
  );

  const mine = (recipes ?? []).filter((r) => r.origin === "manuelle" && !r.is_favorite);
  const cooked = (recipes ?? []).filter(
    (r) => r.origin === "generee" && r.last_cooked && !r.is_favorite,
  );
  const favorites = (recipes ?? []).filter((r) => r.is_favorite);
  const proposals = (recipes ?? []).filter(
    (r) => r.origin === "generee" && !r.last_cooked && !r.is_favorite,
  );

  return (
    <Screen title="Recettes" intro="Des idées depuis ce qu'il y a dans la cuisine.">
      <Button label="Qu'est-ce que je mange ?" onPress={() => router.push("/recettes/proposer")} />
      <Button
        label="Nouvelle recette perso"
        onPress={() => router.push("/recettes/nouvelle")}
        variant="secondary"
      />
      {problem ? <Notice problem>{problem}</Notice> : null}
      {!recipes && !problem ? <ActivityIndicator color={palette.accent} /> : null}
      {favorites.length > 0 ? <SectionTitle>Favorites</SectionTitle> : null}
      {favorites.map((recipe) => (
        <RecipeRow key={recipe.id} recipe={recipe} />
      ))}
      {mine.length > 0 ? <SectionTitle>Mes recettes</SectionTitle> : null}
      {mine.map((recipe) => (
        <RecipeRow key={recipe.id} recipe={recipe} />
      ))}
      {cooked.length > 0 ? <SectionTitle>Déjà cuisinées</SectionTitle> : null}
      {cooked.map((recipe) => (
        <RecipeRow key={recipe.id} recipe={recipe} />
      ))}
      {proposals.length > 0 ? <SectionTitle>Dernières propositions</SectionTitle> : null}
      {proposals.map((recipe) => (
        <RecipeRow key={recipe.id} recipe={recipe} />
      ))}
      {recipes && recipes.length === 0 ? (
        <Text style={{ color: palette.textSecondary }}>
          Aucune recette pour l'instant. Demande une idée, ou dis-en une à Claude.
        </Text>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    borderWidth: 1,
    borderRadius: 12,
    padding: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  title: { fontSize: 16, fontWeight: "500" },
});
