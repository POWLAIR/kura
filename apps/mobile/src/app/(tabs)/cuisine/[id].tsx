import type { InventoryItemView } from "@kura/core";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { Button, Choice, Field, Notice, SectionTitle } from "@/components/ui";
import {
  changesOf,
  formOf,
  type InventoryRow,
  type ItemForm,
  stockUnitOf,
} from "@/inventory/item-form";
import {
  CATEGORY_OPTIONS,
  LEVEL_OPTIONS,
  LOCATION_OPTIONS,
  UNIT_LABELS,
  UNIT_OPTIONS,
} from "@/inventory/options";
import { type FoodHit, fetchItem, searchFoods } from "@/inventory/use-inventory";
import { callApi } from "@/lib/api";
import { errorMessage, NETWORK_MESSAGE } from "@/lib/api-error";
import { confirm } from "@/lib/confirm";
import { today } from "@/lib/today";
import { spacing, usePalette } from "@/theme";

type Loaded = { item: InventoryRow; form: ItemForm; foodName: string | null };

// Fiche d'un article : quantité ou niveau, date, seuil de rachat, emplacement, aliment de
// référence. L'enregistrement passe par update_item, comme le tool MCP ; seuls les champs
// modifiés sont envoyés.
export default function ItemScreen() {
  const palette = usePalette();
  const router = useRouter();
  const id = Number(useLocalSearchParams<{ id: string }>().id);

  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [missing, setMissing] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [foodQuery, setFoodQuery] = useState("");
  const [foodHits, setFoodHits] = useState<FoodHit[] | null>(null);

  useEffect(() => {
    let current = true;
    fetchItem(id)
      .then((item) => {
        if (!current) return;
        if (item) setLoaded({ item, form: formOf(item), foodName: item.food_name });
        else setMissing("Cet article n'est plus dans l'inventaire.");
      })
      .catch(() => current && setMissing(NETWORK_MESSAGE));
    return () => {
      current = false;
    };
  }, [id]);

  if (missing) {
    return (
      <View style={[styles.content, { backgroundColor: palette.background, flex: 1 }]}>
        <View style={styles.column}>
          <Notice problem>{missing}</Notice>
          <Button label="Retour à l'inventaire" onPress={() => router.back()} variant="secondary" />
        </View>
      </View>
    );
  }
  if (!loaded) {
    return (
      <View style={[styles.content, { backgroundColor: palette.background, flex: 1 }]}>
        <ActivityIndicator color={palette.accent} />
      </View>
    );
  }

  const { item, form, foodName } = loaded;
  const set = (changes: Partial<ItemForm>) =>
    setLoaded((previous) => previous && { ...previous, form: { ...previous.form, ...changes } });

  async function save() {
    const changes = changesOf(item, form, today());
    if (!changes.ok) {
      setProblem(changes.message);
      return;
    }
    if (changes.value === null) {
      router.back();
      return;
    }
    setPending(true);
    setProblem(null);
    try {
      const result = await callApi<{ updated: InventoryItemView; notice?: string }>("update_item", {
        item_id: item.id,
        changes: changes.value,
      });
      // Changement d'unité ou de mode de suivi : le serveur le signale, on le montre avant
      // de revenir à la liste.
      if (result.notice) {
        const fresh = await fetchItem(item.id);
        if (fresh) setLoaded({ item: fresh, form: formOf(fresh), foodName: fresh.food_name });
        setNotice(result.notice);
      } else {
        router.back();
      }
    } catch (error) {
      setProblem(errorMessage(error));
    } finally {
      setPending(false);
    }
  }

  async function remove() {
    const confirmed = await confirm(
      `Retirer « ${item.name} » ?`,
      "L'article quitte l'inventaire et son historique est supprimé. Pour un article simplement terminé, mets plutôt sa quantité à zéro.",
      "Retirer",
    );
    if (!confirmed) return;
    setPending(true);
    setProblem(null);
    try {
      await callApi("remove_item", { item_id: item.id });
      router.back();
    } catch (error) {
      setProblem(errorMessage(error));
      setPending(false);
    }
  }

  async function search() {
    if (foodQuery.trim().length < 2) return;
    try {
      setFoodHits(await searchFoods(foodQuery));
    } catch {
      setProblem(NETWORK_MESSAGE);
    }
  }

  function chooseFood(food: FoodHit | null) {
    setLoaded(
      (previous) =>
        previous && {
          ...previous,
          foodName: food ? food.name : null,
          form: { ...previous.form, foodRefId: food ? food.id : null },
        },
    );
    setFoodHits(null);
    setFoodQuery("");
  }

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      style={{ backgroundColor: palette.background }}
    >
      <View style={styles.column}>
        {notice ? <Notice>{notice}</Notice> : null}

        <Field label="Nom" onChangeText={(name) => set({ name })} value={form.name} />

        <SectionTitle>En stock</SectionTitle>
        <Choice
          label="Suivi"
          onChange={(mode) => set({ mode })}
          options={[
            { value: "quantity", label: "En quantité" },
            { value: "level", label: "En niveau" },
          ]}
          value={form.mode}
        />
        {form.mode === "quantity" ? (
          <>
            <Field
              inputMode="decimal"
              label="Quantité restante"
              onChangeText={(quantity) => set({ quantity })}
              value={form.quantity}
            />
            <Choice
              label="Unité"
              onChange={(unit) => set({ unit })}
              options={UNIT_OPTIONS}
              value={form.unit}
            />
            <Field
              hint="Sous ce seuil, l'article passe dans la liste « À racheter ». Laisse vide pour ne pas le suivre."
              inputMode="decimal"
              label={`Seuil de rachat (${UNIT_LABELS[stockUnitOf(form)]})`}
              onChangeText={(restockThreshold) => set({ restockThreshold })}
              value={form.restockThreshold}
            />
          </>
        ) : (
          <>
            <Choice
              label="Niveau"
              onChange={(level) => set({ level })}
              options={LEVEL_OPTIONS}
              value={form.level}
            />
            <Choice
              label="À racheter à partir de (touche à nouveau pour retirer le seuil)"
              onChange={(level) =>
                set({ restockLevel: level === form.restockLevel ? null : level })
              }
              options={LEVEL_OPTIONS}
              value={form.restockLevel}
            />
          </>
        )}
        <Field
          hint="Par exemple 24/12 ou 24/12/2026 ; sans année, c'est la prochaine fois que cette date arrive. Laisse vide s'il n'y en a pas."
          label="Date de péremption"
          onChangeText={(expires) => set({ expires })}
          placeholder="JJ/MM"
          value={form.expires}
        />

        <SectionTitle>Rangement</SectionTitle>
        <Choice
          label="Emplacement"
          onChange={(location) => set({ location })}
          options={LOCATION_OPTIONS}
          value={form.location}
        />
        <Choice
          label="Catégorie"
          onChange={(category) => set({ category })}
          options={CATEGORY_OPTIONS}
          value={form.category}
        />

        <SectionTitle>Aliment de référence</SectionTitle>
        <Text style={{ color: palette.textSecondary, lineHeight: 22 }}>
          {form.foodRefId === null
            ? "Aucun : les valeurs nutritionnelles de cet article ne sont pas renseignées."
            : `${foodName ?? "Aliment choisi"}. Ses valeurs nutritionnelles viennent de Ciqual ou d'Open Food Facts.`}
        </Text>
        <Field
          label="Chercher un aliment"
          onChangeText={setFoodQuery}
          onSubmitEditing={search}
          placeholder="riz blanc, œuf…"
          returnKeyType="search"
          value={foodQuery}
        />
        <View style={styles.inline}>
          <Button label="Chercher" onPress={search} variant="secondary" />
          {form.foodRefId !== null ? (
            <Button label="Délier" onPress={() => chooseFood(null)} variant="quiet" />
          ) : null}
        </View>
        {foodHits?.length === 0 ? (
          <Text style={{ color: palette.textSecondary }}>Aucun aliment ne porte ce nom.</Text>
        ) : null}
        {foodHits?.map((food) => (
          <Button
            key={food.id}
            label={food.brand ? `${food.name} · ${food.brand}` : food.name}
            onPress={() => chooseFood(food)}
            variant="secondary"
          />
        ))}

        {problem ? <Notice problem>{problem}</Notice> : null}
        <Button busy={pending} label="Enregistrer" onPress={save} />
        <Button
          disabled={pending}
          label="Retirer de l'inventaire"
          onPress={remove}
          variant="quiet"
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, alignItems: "center" },
  column: { width: "100%", maxWidth: 720, gap: spacing.md },
  inline: { flexDirection: "row", gap: spacing.sm },
});
