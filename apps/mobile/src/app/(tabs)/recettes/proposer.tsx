import { nutritionBrief, type RecipeView } from "@kura/core";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Button, Choice, Field, Notice, Tag } from "@/components/ui";
import { errorMessage } from "@/lib/api-error";
import { suggestRecipes } from "@/recipes/data";
import { spacing, usePalette } from "@/theme";

const TIMES = [
  { value: "any", label: "Peu importe" },
  { value: "15", label: "15 min" },
  { value: "30", label: "30 min" },
  { value: "45", label: "45 min" },
  { value: "60", label: "1 h" },
] as const;
const SERVINGS = [
  { value: "1", label: "1" },
  { value: "2", label: "2" },
  { value: "3", label: "3" },
  { value: "4", label: "4" },
] as const;

type Time = (typeof TIMES)[number]["value"];
type Servings = (typeof SERVINGS)[number]["value"];

// « Qu'est-ce que je mange ? » : trois recettes depuis le stock, celles qui utilisent un
// produit qui périme bientôt d'abord. Les valeurs viennent de food_ref, jamais du modèle.
export default function ProposeScreen() {
  const palette = usePalette();
  const router = useRouter();
  const [time, setTime] = useState<Time>("any");
  const [servings, setServings] = useState<Servings>("2");
  const [craving, setCraving] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [recipes, setRecipes] = useState<RecipeView[]>([]);

  async function propose() {
    setBusy(true);
    setProblem(null);
    setNotice(null);
    try {
      const result = await suggestRecipes({
        servings: Number(servings),
        ...(time !== "any" && { max_minutes: Number(time) }),
        ...(craving.trim() && { craving: craving.trim() }),
      });
      setRecipes(result.recipes);
      setNotice(result.notice ?? null);
    } catch (error) {
      setProblem(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      style={{ backgroundColor: palette.background }}
    >
      <View style={styles.column}>
        <Choice label="Temps disponible" onChange={setTime} options={TIMES} value={time} />
        <Choice label="Portions" onChange={setServings} options={SERVINGS} value={servings} />
        <Field
          label="Une envie ? (facultatif)"
          maxLength={200}
          onChangeText={setCraving}
          placeholder="quelque chose d'asiatique"
          value={craving}
        />
        <Button
          busy={busy}
          label={recipes.length > 0 ? "D'autres idées" : "Proposer"}
          onPress={propose}
        />
        {busy ? (
          <Text style={{ color: palette.textSecondary }}>
            Un instant, je regarde ce qu'il y a dans la cuisine…
          </Text>
        ) : null}
        {problem ? <Notice problem>{problem}</Notice> : null}
        {notice ? <Notice>{notice}</Notice> : null}
        {recipes.map((recipe) => (
          <Pressable
            accessibilityHint="Ouvre la recette"
            accessibilityRole="button"
            key={recipe.id}
            onPress={() =>
              router.push({ pathname: "/recettes/[id]", params: { id: String(recipe.id) } })
            }
            style={({ pressed }) => [
              styles.card,
              { backgroundColor: palette.surface, borderColor: palette.border },
              pressed && { opacity: 0.8 },
            ]}
          >
            <Text style={[styles.title, { color: palette.text }]}>{recipe.title}</Text>
            <Text style={{ color: palette.textSecondary }}>
              {[
                recipe.total_minutes ? `${recipe.total_minutes} min` : null,
                `${recipe.servings} portions`,
              ]
                .filter(Boolean)
                .join(" · ")}
            </Text>
            {recipe.uses_expiring && recipe.uses_expiring.length > 0 ? (
              <View style={styles.tags}>
                <Tag
                  strong
                >{`Utilise ce qui périme bientôt : ${recipe.uses_expiring.join(", ")}`}</Tag>
              </View>
            ) : null}
            {recipe.nutrition_per_portion ? (
              <Text style={[styles.note, { color: palette.textSecondary }]}>
                Par portion : {nutritionBrief(recipe.nutrition_per_portion)}
              </Text>
            ) : null}
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, alignItems: "center" },
  column: { width: "100%", maxWidth: 720, gap: spacing.md },
  card: { borderWidth: 1, borderRadius: 12, padding: spacing.md, gap: spacing.xs },
  title: { fontSize: 17, fontWeight: "600" },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  note: { fontSize: 13, lineHeight: 18 },
});
