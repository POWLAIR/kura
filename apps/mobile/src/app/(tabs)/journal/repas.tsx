import { Ean, type MissingConversion } from "@kura/core";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { BarcodeCamera } from "@/components/barcode-camera";
import { Button, Choice, Field, Notice, SectionTitle } from "@/components/ui";
import { parseQuantity } from "@/inventory/item-form";
import { UNIT_OPTIONS } from "@/inventory/options";
import { acceptScan, type ScannedFood } from "@/inventory/scan";
import { type FoodHit, searchFoods } from "@/inventory/use-inventory";
import { type MealForm, type MealItemForm, mealInputOf, whenNow } from "@/journal/forms";
import { callApi, callOffProduct } from "@/lib/api";
import { errorMessage, NETWORK_MESSAGE } from "@/lib/api-error";
import { createKeyring, withKey } from "@/lib/idempotency";
import { today } from "@/lib/today";
import { spacing, usePalette } from "@/theme";

type OffAnswer = { found: true; food: ScannedFood } | { found: false; ean: string };
type Logged = { meal: { id: number; label: string }; missing_conversions?: MissingConversion[] };

const CONVERSION_LABELS = {
  piece_weight_g: (food: string) => `Poids d'une pièce de « ${food} » (g)`,
  density_g_ml: (food: string) => `Densité de « ${food} » (g par ml)`,
} as const;

// Saisir un repas : des aliments cherchés dans le référentiel ou scannés, avec la quantité
// mangée dans l'unité dite. Les valeurs nutritionnelles sont calculées par le serveur depuis
// Ciqual et Open Food Facts (opération log_meal) ; l'app n'en estime aucune.
export default function MealScreen() {
  const palette = usePalette();
  const router = useRouter();
  const params = useLocalSearchParams<{ day?: string }>();

  const [form, setForm] = useState<MealForm>(() => ({
    ...whenNow(params.day ?? today(), new Date()),
    label: "",
    items: [],
  }));
  const [keyring] = useState(() => createKeyring("repas"));
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<FoodHit[] | null>(null);
  const [code, setCode] = useState("");
  const [camera, setCamera] = useState(false);
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [missing, setMissing] = useState<MissingConversion[] | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const itemCount = useRef(0);
  const seen = useRef(new Map<string, number>());

  const set = (changes: Partial<MealForm>) => setForm((previous) => ({ ...previous, ...changes }));

  function addItem(name: string, foodRefId: number | null, unit: MealItemForm["unit"] = "g") {
    itemCount.current += 1;
    const item: MealItemForm = {
      key: `aliment-${itemCount.current}`,
      name,
      foodRefId,
      quantity: "",
      unit,
    };
    setForm((previous) => ({ ...previous, items: [...previous.items, item] }));
    setHits(null);
    setQuery("");
    setProblem(null);
  }

  const changeItem = (itemKey: string, changes: Partial<MealItemForm>) =>
    setForm((previous) => ({
      ...previous,
      items: previous.items.map((item) => (item.key === itemKey ? { ...item, ...changes } : item)),
    }));

  async function search() {
    if (query.trim().length < 2) return;
    try {
      setHits(await searchFoods(query));
    } catch {
      setProblem(NETWORK_MESSAGE);
    }
  }

  async function addCode(raw: string, typed: boolean) {
    const parsed = Ean.safeParse(raw);
    if (!parsed.success) {
      if (typed) setProblem("Ce n'est pas un code-barres : 8, 12 ou 13 chiffres sont attendus.");
      return;
    }
    if (!typed && !acceptScan(parsed.data, Date.now(), seen.current)) return;
    try {
      const answer = await callOffProduct<OffAnswer>(parsed.data);
      if (answer.found) {
        addItem(answer.food.name, answer.food.id, answer.food.package_unit ?? "g");
        setCamera(false);
      } else {
        setProblem("Ce produit est inconnu d'Open Food Facts. Cherche-le par son nom.");
      }
    } catch (error) {
      setProblem(errorMessage(error));
    }
  }

  async function save() {
    const input = mealInputOf(form, today(), "cle-a-venir");
    if (!input.ok) {
      setProblem(input.message);
      return;
    }
    setPending(true);
    setProblem(null);
    try {
      const logged = await callApi<Logged>("log_meal", withKey(keyring, input.value));
      if (logged.missing_conversions && logged.missing_conversions.length > 0) {
        setMissing(logged.missing_conversions);
      } else {
        router.back();
      }
    } catch (error) {
      setProblem(errorMessage(error));
    } finally {
      setPending(false);
    }
  }

  // Poids d'une pièce ou densité : donnés par l'utilisateur, jamais estimés. Le serveur
  // recalcule le repas (et les précédents) avec la valeur.
  async function saveConversion(conversion: MissingConversion) {
    const id = `${conversion.food_ref_id}:${conversion.field}`;
    const value = parseQuantity(values[id] ?? "");
    if (value === null || value === 0) {
      setProblem("Un nombre positif est attendu : pèse l'aliment, ou lis l'emballage.");
      return;
    }
    setPending(true);
    setProblem(null);
    try {
      await callApi("set_food_conversion", {
        food_ref_id: conversion.food_ref_id,
        [conversion.field]: value,
      });
      const rest = (missing ?? []).filter((other) => other !== conversion);
      if (rest.length === 0) router.back();
      else setMissing(rest);
    } catch (error) {
      setProblem(errorMessage(error));
    } finally {
      setPending(false);
    }
  }

  if (missing) {
    return (
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        style={{ backgroundColor: palette.background }}
      >
        <View style={styles.column}>
          <Notice>
            Le repas est enregistré, avec des valeurs partielles : pour le compter en entier, il
            manque une mesure que toi seul peux donner. Pèse l'aliment ou lis l'emballage ; rien
            n'est estimé à ta place.
          </Notice>
          {missing.map((conversion) => {
            const id = `${conversion.food_ref_id}:${conversion.field}`;
            return (
              <View key={id} style={styles.inline}>
                <View style={styles.grow}>
                  <Field
                    inputMode="decimal"
                    label={CONVERSION_LABELS[conversion.field](conversion.food ?? conversion.name)}
                    onChangeText={(text) => setValues((previous) => ({ ...previous, [id]: text }))}
                    value={values[id] ?? ""}
                  />
                </View>
                <Button
                  disabled={pending}
                  label="Enregistrer"
                  onPress={() => saveConversion(conversion)}
                  variant="secondary"
                />
              </View>
            );
          })}
          {problem ? <Notice problem>{problem}</Notice> : null}
          <Button label="Plus tard" onPress={() => router.back()} variant="quiet" />
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      style={{ backgroundColor: palette.background }}
    >
      <View style={styles.column}>
        <Field
          label="Nom du repas"
          onChangeText={(label) => set({ label })}
          placeholder="Riz teriyaki aux œufs"
          value={form.label}
        />
        <View style={styles.inline}>
          <View style={styles.grow}>
            <Field
              label="Date"
              onChangeText={(date) => set({ date })}
              placeholder="JJ/MM"
              value={form.date}
            />
          </View>
          <View style={styles.grow}>
            <Field
              label="Heure"
              onChangeText={(time) => set({ time })}
              placeholder="12h30"
              value={form.time}
            />
          </View>
        </View>

        <SectionTitle>{`Aliments (${form.items.length})`}</SectionTitle>
        {form.items.map((item) => (
          <View
            accessibilityLabel={`Aliment ${item.name}`}
            key={item.key}
            style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}
          >
            <View style={styles.cardHead}>
              <Text style={[styles.name, { color: palette.text }]}>{item.name}</Text>
              <Button
                label="Retirer"
                onPress={() => set({ items: form.items.filter((other) => other.key !== item.key) })}
                variant="quiet"
              />
            </View>
            {item.foodRefId === null ? (
              <Text style={{ color: palette.textSecondary }}>
                Sans aliment de référence : il ne sera pas compté dans les valeurs du repas.
              </Text>
            ) : null}
            <Field
              inputMode="decimal"
              label={`Quantité mangée, ${item.name}`}
              onChangeText={(quantity) => changeItem(item.key, { quantity })}
              value={item.quantity}
            />
            <Choice
              label="Unité"
              onChange={(unit) => changeItem(item.key, { unit })}
              options={UNIT_OPTIONS}
              value={item.unit}
            />
          </View>
        ))}

        <View style={styles.inline}>
          <View style={styles.grow}>
            <Field
              label="Chercher un aliment"
              onChangeText={setQuery}
              onSubmitEditing={search}
              placeholder="riz blanc, œuf…"
              returnKeyType="search"
              value={query}
            />
          </View>
          <Button label="Chercher" onPress={search} variant="secondary" />
        </View>
        {hits?.map((food) => (
          <Button
            key={food.id}
            label={food.brand ? `${food.name} · ${food.brand}` : food.name}
            onPress={() => addItem(food.name, food.id)}
            variant="secondary"
          />
        ))}
        {hits !== null && query.trim() !== "" ? (
          <Button
            label={`Ajouter « ${query.trim()} » sans aliment de référence`}
            onPress={() => addItem(query.trim(), null)}
            variant="quiet"
          />
        ) : null}

        <View style={styles.inline}>
          <View style={styles.grow}>
            <Field
              inputMode="numeric"
              label="Code-barres d'un produit"
              onChangeText={setCode}
              placeholder="Ou scanne-le"
              value={code}
            />
          </View>
          <Button
            label="Ajouter le produit"
            onPress={() => {
              addCode(code, true);
              setCode("");
            }}
            variant="secondary"
          />
        </View>
        {camera ? (
          <BarcodeCamera onCode={(data) => addCode(data, false)} />
        ) : (
          <Button label="Scanner un produit" onPress={() => setCamera(true)} variant="quiet" />
        )}

        {problem ? <Notice problem>{problem}</Notice> : null}
        <Button busy={pending} label="Enregistrer le repas" onPress={save} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, alignItems: "center" },
  column: { width: "100%", maxWidth: 720, gap: spacing.md },
  inline: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm },
  grow: { flex: 1 },
  card: { borderWidth: 1, borderRadius: 12, padding: spacing.md, gap: spacing.sm },
  cardHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  name: { fontSize: 16, fontWeight: "600", flexShrink: 1 },
});
