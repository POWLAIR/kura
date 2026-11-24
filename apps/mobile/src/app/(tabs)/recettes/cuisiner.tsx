import { formatAmount, type QuantityUnit, type RecipeView } from "@kura/core";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Button, Notice, SectionTitle } from "@/components/ui";
import { errorMessage } from "@/lib/api-error";
import { createKeyring } from "@/lib/idempotency";
import { type CookResult, cookRecipe, fetchRecipe } from "@/recipes/data";
import { spacing, usePalette } from "@/theme";

const decimal = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 });

function Stepper(props: {
  label: string;
  hint: string;
  value: number;
  step: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  const palette = usePalette();
  const button = (sign: -1 | 1) => {
    const next = Math.round((props.value + sign * props.step) * 100) / 100;
    const disabled = next < props.min || next > props.max;
    return (
      <Pressable
        accessibilityLabel={sign < 0 ? `Moins de ${props.label}` : `Plus de ${props.label}`}
        accessibilityRole="button"
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={() => props.onChange(next)}
        style={[styles.stepButton, { borderColor: palette.border, opacity: disabled ? 0.4 : 1 }]}
      >
        <Text style={{ color: palette.text, fontSize: 20 }}>{sign < 0 ? "−" : "+"}</Text>
      </Pressable>
    );
  };
  return (
    <View style={{ gap: spacing.xs }}>
      <Text style={{ color: palette.textSecondary }}>{props.label}</Text>
      <View style={styles.stepper}>
        {button(-1)}
        <Text
          accessibilityLabel={`${props.label} : ${decimal.format(props.value)}`}
          style={[styles.stepValue, { color: palette.text }]}
        >
          {decimal.format(props.value)}
        </Text>
        {button(1)}
      </View>
      <Text style={{ color: palette.textSecondary, fontSize: 13 }}>{props.hint}</Text>
    </View>
  );
}

// « J'ai cuisiné » : portions cuisinées (décomptées du stock) et mangées (comptées dans le
// repas), puis cook_recipe en une transaction. Le récapitulatif dit ce qui a été décompté
// et ce qui reste à ajuster à la main, sans rien estimer.
export default function CookScreen() {
  const palette = usePalette();
  const router = useRouter();
  const id = Number(useLocalSearchParams<{ id: string }>().id);
  const keyring = useRef(createKeyring("cuisine")).current;
  const [recipe, setRecipe] = useState<RecipeView | null>(null);
  const [cooked, setCooked] = useState(1);
  const [eaten, setEaten] = useState(1);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [result, setResult] = useState<CookResult | null>(null);

  useEffect(() => {
    let current = true;
    fetchRecipe(id)
      .then(({ recipe: found }) => {
        if (!current) return;
        setRecipe(found);
        setCooked(found.servings);
      })
      .catch((error) => current && setProblem(errorMessage(error)));
    return () => {
      current = false;
    };
  }, [id]);

  async function cook() {
    if (!recipe) return;
    setBusy(true);
    setProblem(null);
    const input = { recipe_id: recipe.id, portions_cooked: cooked, portions_eaten: eaten };
    try {
      setResult(await cookRecipe({ ...input, idempotency_key: keyring.keyFor(input) }));
    } catch (error) {
      setProblem(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  if (!recipe) {
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

  if (result) {
    const stock = result.stock;
    return (
      <ScrollView
        contentContainerStyle={styles.content}
        style={{ backgroundColor: palette.background }}
      >
        <View style={styles.column}>
          <Notice>{`« ${recipe.title} » est dans le journal.`}</Notice>
          {stock && stock.decremented.length > 0 ? (
            <>
              <SectionTitle level={3}>Retiré du stock</SectionTitle>
              {stock.decremented.map((line) => (
                <Text key={line.item_id} style={{ color: palette.text }}>
                  {`${line.item} : ${formatAmount({ quantity: line.used, unit: line.unit as QuantityUnit })}`}
                </Text>
              ))}
            </>
          ) : null}
          {stock && stock.to_adjust.length > 0 ? (
            <>
              <SectionTitle level={3}>À ajuster dans la Cuisine</SectionTitle>
              <Text style={{ color: palette.textSecondary }}>
                Ces articles n'ont pas été décomptés en entier : dis ce qu'il en reste dans leur
                fiche.
              </Text>
              {stock.to_adjust.map((line) => (
                <Pressable
                  accessibilityRole="button"
                  accessibilityHint="Ouvre la fiche de l'article"
                  key={`${line.item_id}-${line.ingredient}`}
                  onPress={() =>
                    router.push({ pathname: "/cuisine/[id]", params: { id: String(line.item_id) } })
                  }
                >
                  <Text style={{ color: palette.accent }}>{`${line.item} (${line.reason})`}</Text>
                </Pressable>
              ))}
            </>
          ) : null}
          {result.missing_conversions && result.missing_conversions.length > 0 ? (
            <Text style={{ color: palette.textSecondary }}>
              Valeurs partielles : le poids d'une pièce ou la densité de certains ingrédients
              manque. Tu peux les donner depuis la fiche du repas.
            </Text>
          ) : null}
          <Button
            label="Voir le repas"
            onPress={() =>
              router.push({
                pathname: "/journal/fiche-repas",
                params: { id: String(result.meal.id) },
              })
            }
          />
          <Button label="Retour à la recette" onPress={() => router.back()} variant="secondary" />
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      style={{ backgroundColor: palette.background }}
    >
      <View style={styles.column}>
        <Text accessibilityRole="header" style={[styles.title, { color: palette.text }]}>
          {recipe.title}
        </Text>
        <Stepper
          hint={`La recette est prévue pour ${recipe.servings}. Le stock est décompté pour ces portions.`}
          label="Portions cuisinées"
          max={50}
          min={1}
          onChange={(value) => {
            setCooked(value);
            if (eaten > value) setEaten(value);
          }}
          step={1}
          value={cooked}
        />
        <Stepper
          hint="Le repas compte ces portions."
          label="Portions mangées"
          max={cooked}
          min={0.5}
          onChange={setEaten}
          step={0.5}
          value={eaten}
        />
        {problem ? <Notice problem>{problem}</Notice> : null}
        <Button busy={busy} label="Enregistrer" onPress={cook} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, alignItems: "center" },
  column: { width: "100%", maxWidth: 720, gap: spacing.md },
  title: { fontSize: 22, fontWeight: "600" },
  stepper: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  stepButton: {
    borderWidth: 1,
    borderRadius: 999,
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  stepValue: { fontSize: 22, fontWeight: "600", minWidth: 48, textAlign: "center" },
});
