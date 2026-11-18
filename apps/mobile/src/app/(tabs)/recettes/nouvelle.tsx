import { type InventoryLocation, LOCATION_LABELS } from "@kura/core";
import { useRouter } from "expo-router";
import { useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Button, Choice, Field, Notice, SectionTitle } from "@/components/ui";
import { errorMessage } from "@/lib/api-error";
import { createKeyring } from "@/lib/idempotency";
import { type SaveRecipeResult, saveRecipe } from "@/recipes/data";
import {
  emptyIngredient,
  type IngredientForm,
  type IngredientUnit,
  type RecipeForm,
  recipeInput,
} from "@/recipes/form";
import { spacing, usePalette } from "@/theme";

const UNITS = [
  { value: "g", label: "g" },
  { value: "ml", label: "ml" },
  { value: "piece", label: "pièce" },
  { value: "none", label: "à votre goût" },
] as const;

type Ambiguity = Extract<SaveRecipeResult, { saved: false }>["ambiguous"][number];

const AMBIGUITY_TEXT: Record<Ambiguity["reason"], string> = {
  food: "Quel aliment de référence ? Il sert à calculer les valeurs.",
  unknown_food: "Aliment de référence introuvable : choisis-en un autre.",
  several_items: "Plusieurs articles du stock correspondent : lequel ?",
  unknown_item: "Cet article n'est plus dans le stock.",
};

// Recette perso : titre, portions, temps, ingrédients rapprochés de Ciqual et du stock par
// le serveur (save_recipe, comme pour Claude), étapes. Quand un ingrédient est ambigu, rien
// n'est enregistré : on choisit parmi les candidats, puis on enregistre de nouveau.
export default function NewRecipeScreen() {
  const palette = usePalette();
  const router = useRouter();
  const keyring = useRef(createKeyring("recette")).current;
  const [form, setForm] = useState<RecipeForm>({
    title: "",
    servings: "2",
    minutes: "",
    steps: "",
    ingredients: [emptyIngredient()],
  });
  const [ambiguous, setAmbiguous] = useState<Map<string, Ambiguity>>(new Map());
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const setIngredient = (key: string, changes: Partial<IngredientForm>) =>
    setForm((previous) => ({
      ...previous,
      ingredients: previous.ingredients.map((i) => (i.key === key ? { ...i, ...changes } : i)),
    }));

  function resolve(key: string, changes: Partial<IngredientForm>) {
    setIngredient(key, changes);
    setAmbiguous((previous) => {
      const next = new Map(previous);
      next.delete(key);
      return next;
    });
  }

  async function save() {
    const input = recipeInput(form);
    if (!input.ok) {
      setProblem(input.message);
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const result = await saveRecipe({
        ...input.value,
        idempotency_key: keyring.keyFor(input.value),
      });
      if ("recipe" in result) {
        router.replace({ pathname: "/recettes/[id]", params: { id: String(result.recipe.id) } });
        return;
      }
      // Les index renvoyés suivent les ingrédients remplis, dans l'ordre.
      const filled = form.ingredients.filter((i) => i.name.trim());
      setAmbiguous(
        new Map(
          result.ambiguous.flatMap((a) => {
            const key = filled[a.index]?.key;
            return key ? [[key, a] as const] : [];
          }),
        ),
      );
      setProblem("Rien n'est enregistré : précise les ingrédients signalés, puis enregistre.");
    } catch (error) {
      setProblem(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  const chip = (label: string, onPress: () => void) => (
    <Pressable
      accessibilityRole="button"
      key={label}
      onPress={onPress}
      style={[styles.chip, { borderColor: palette.border, backgroundColor: palette.surface }]}
    >
      <Text style={{ color: palette.text }}>{label}</Text>
    </Pressable>
  );

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      style={{ backgroundColor: palette.background }}
    >
      <View style={styles.column}>
        <Field
          label="Titre"
          maxLength={200}
          onChangeText={(title) => setForm({ ...form, title })}
          placeholder="Gomasio maison"
          value={form.title}
        />
        <View style={styles.pair}>
          <View style={{ flex: 1 }}>
            <Field
              inputMode="numeric"
              label="Portions"
              onChangeText={(servings) => setForm({ ...form, servings })}
              value={form.servings}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Field
              inputMode="numeric"
              label="Temps (min, facultatif)"
              onChangeText={(minutes) => setForm({ ...form, minutes })}
              value={form.minutes}
            />
          </View>
        </View>

        <SectionTitle>Ingrédients</SectionTitle>
        <Text style={{ color: palette.textSecondary }}>
          Quantités pour toute la recette. Chaque ingrédient est rapproché de Ciqual et du stock.
        </Text>
        {form.ingredients.map((ingredient, position) => {
          const ambiguity = ambiguous.get(ingredient.key);
          return (
            <View key={ingredient.key} style={[styles.ingredient, { borderColor: palette.border }]}>
              <Field
                label={`Ingrédient ${position + 1}`}
                maxLength={100}
                onChangeText={(name) =>
                  setIngredient(ingredient.key, {
                    name,
                    food_ref_id: undefined,
                    item_id: undefined,
                    choice: undefined,
                  })
                }
                placeholder="riz basmati"
                value={ingredient.name}
              />
              <Choice
                label="Unité"
                onChange={(unit: IngredientUnit) => setIngredient(ingredient.key, { unit })}
                options={UNITS}
                value={ingredient.unit}
              />
              {ingredient.unit !== "none" ? (
                <Field
                  inputMode="decimal"
                  label="Quantité"
                  onChangeText={(quantity) => setIngredient(ingredient.key, { quantity })}
                  value={ingredient.quantity}
                />
              ) : null}
              {ingredient.choice ? (
                <Text style={{ color: palette.textSecondary, fontSize: 13 }}>
                  {ingredient.choice}
                </Text>
              ) : null}
              {ambiguity ? (
                <View style={{ gap: spacing.xs }}>
                  <Notice>{AMBIGUITY_TEXT[ambiguity.reason]}</Notice>
                  <View style={styles.chips}>
                    {ambiguity.reason === "food" || ambiguity.reason === "unknown_food"
                      ? [
                          ...ambiguity.candidates.map((c) =>
                            chip(c.name, () =>
                              resolve(ingredient.key, {
                                food_ref_id: c.food_ref_id,
                                choice: `Référence : ${c.name}`,
                              }),
                            ),
                          ),
                          chip("Aucun de ceux-là", () =>
                            resolve(ingredient.key, {
                              food_ref_id: null,
                              choice: "Sans aliment de référence : non compté dans les valeurs",
                            }),
                          ),
                        ]
                      : [
                          ...ambiguity.items.map((item) =>
                            chip(
                              `${item.name} (${LOCATION_LABELS[item.location as InventoryLocation]})`,
                              () =>
                                resolve(ingredient.key, {
                                  item_id: item.item_id,
                                  choice: `Du stock : ${item.name}`,
                                }),
                            ),
                          ),
                          chip("Pas du stock", () =>
                            resolve(ingredient.key, {
                              item_id: null,
                              choice: "Ne vient pas du stock",
                            }),
                          ),
                        ]}
                  </View>
                </View>
              ) : null}
              {form.ingredients.length > 1 ? (
                <Button
                  label="Retirer cet ingrédient"
                  onPress={() =>
                    setForm({
                      ...form,
                      ingredients: form.ingredients.filter((i) => i.key !== ingredient.key),
                    })
                  }
                  variant="quiet"
                />
              ) : null}
            </View>
          );
        })}
        <Button
          label="Ajouter un ingrédient"
          onPress={() =>
            setForm({ ...form, ingredients: [...form.ingredients, emptyIngredient()] })
          }
          variant="secondary"
        />

        <SectionTitle>Étapes</SectionTitle>
        <Field
          label="Une étape par ligne"
          multiline
          onChangeText={(steps) => setForm({ ...form, steps })}
          placeholder={"Griller le sésame à sec.\nLe piler avec le sel."}
          style={{ minHeight: 120, textAlignVertical: "top" }}
          value={form.steps}
        />

        {problem ? <Notice problem>{problem}</Notice> : null}
        <Button busy={busy} label="Enregistrer la recette" onPress={save} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, alignItems: "center" },
  column: { width: "100%", maxWidth: 720, gap: spacing.md },
  pair: { flexDirection: "row", gap: spacing.md },
  ingredient: { borderWidth: 1, borderRadius: 12, padding: spacing.md, gap: spacing.sm },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: spacing.md, paddingVertical: 6 },
});
