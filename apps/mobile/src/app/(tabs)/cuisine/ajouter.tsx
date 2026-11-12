import {
  type AddItemsResult,
  formatAmount,
  type InventoryItemView,
  LEVEL_LABELS,
  LOCATION_LABELS,
  type PurchaseAmbiguity,
} from "@kura/core";
import { useRouter } from "expo-router";
import { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { Button, Choice, Field, Notice, SectionTitle } from "@/components/ui";
import {
  ambiguityMessage,
  EMPTY_PURCHASE,
  hasNoMatch,
  type PurchaseChoice,
  type PurchaseForm,
  purchaseOf,
} from "@/inventory/item-form";
import { CATEGORY_OPTIONS, LOCATION_OPTIONS, UNIT_OPTIONS } from "@/inventory/options";
import { callApi } from "@/lib/api";
import { errorMessage } from "@/lib/api-error";
import { createKeyring } from "@/lib/idempotency";
import { today } from "@/lib/today";
import { spacing, usePalette } from "@/theme";

type Done = { action: "created" | "restocked"; item: InventoryItemView };

// Quantité d'un article existant, telle que la renvoie add_items (« 500 g », « moitie »).
function existingAmount(amount: string): string {
  return amount in LEVEL_LABELS ? LEVEL_LABELS[amount as keyof typeof LEVEL_LABELS] : amount;
}

// Ajouter un article en texte libre. Les règles sont celles du tool add_items : un article
// déjà en stock est réapprovisionné, sinon il est créé ; rien n'est deviné, une ambiguïté
// se tranche à l'écran.
export default function AddItemScreen() {
  const palette = usePalette();
  const router = useRouter();
  const [form, setForm] = useState<PurchaseForm>(EMPTY_PURCHASE);
  const [keyring] = useState(() => createKeyring("courses"));
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [ambiguity, setAmbiguity] = useState<PurchaseAmbiguity | null>(null);
  const [done, setDone] = useState<Done | null>(null);

  const set = (changes: Partial<PurchaseForm>) =>
    setForm((previous) => ({ ...previous, ...changes }));

  async function submit(choice: PurchaseChoice = {}) {
    const purchase = purchaseOf(form, today(), choice);
    if (!purchase.ok) {
      setProblem(purchase.message);
      return;
    }
    setPending(true);
    setProblem(null);
    try {
      const result = await callApi<AddItemsResult>("add_items", {
        items: [purchase.value],
        idempotency_key: keyring.keyFor(purchase.value),
      });
      keyring.reset();
      const [created] = result.created;
      const [restocked] = result.restocked;
      setAmbiguity(result.ambiguous[0] ?? null);
      if (created) setDone({ action: "created", item: created });
      else if (restocked) setDone({ action: "restocked", item: restocked });
    } catch (error) {
      setProblem(errorMessage(error));
    } finally {
      setPending(false);
    }
  }

  function startOver() {
    setForm(EMPTY_PURCHASE);
    setAmbiguity(null);
    setProblem(null);
    setDone(null);
  }

  if (done) {
    const { item } = done;
    return (
      <ScrollView
        contentContainerStyle={styles.content}
        style={{ backgroundColor: palette.background }}
      >
        <View style={styles.column}>
          <Notice>
            {done.action === "created"
              ? `« ${item.name} » est ajouté : ${formatAmount(item)}, ${LOCATION_LABELS[item.location].toLowerCase()}.`
              : `« ${item.name} » est réapprovisionné : ${formatAmount(item)} en stock.`}
          </Notice>
          <Button label="Ajouter un autre article" onPress={startOver} />
          <Button label="Retour à l'inventaire" onPress={() => router.back()} variant="secondary" />
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
          autoCapitalize="sentences"
          label="Nom"
          onChangeText={(name) => set({ name })}
          placeholder="Riz, œufs, sauce soja…"
          value={form.name}
        />
        <Choice
          label="Catégorie"
          onChange={(category) => set({ category })}
          options={CATEGORY_OPTIONS}
          value={form.category}
        />
        <Field
          hint="Laisse vide pour un pot, une bouteille ou une épice : l'article sera suivi en niveau (plein, moitié, presque vide)."
          inputMode="decimal"
          label="Quantité achetée"
          onChangeText={(quantity) => set({ quantity })}
          placeholder="ex. 500"
          value={form.quantity}
        />
        {form.quantity.trim() !== "" ? (
          <Choice
            label="Unité"
            onChange={(unit) => set({ unit })}
            options={UNIT_OPTIONS}
            value={form.unit}
          />
        ) : null}
        <Choice
          label="Emplacement (sinon selon la catégorie)"
          onChange={(location) => set({ location: location === form.location ? null : location })}
          options={LOCATION_OPTIONS}
          value={form.location}
        />
        <Field
          hint="Optionnelle. Par exemple 24/12 ou 24/12/2026 ; sans année, c'est la prochaine fois que cette date arrive."
          label="Date de péremption"
          onChangeText={(expires) => set({ expires })}
          placeholder="JJ/MM"
          value={form.expires}
        />

        {problem ? <Notice problem>{problem}</Notice> : null}

        {ambiguity ? (
          <View style={styles.choices}>
            <Notice problem>{ambiguityMessage(ambiguity)}</Notice>
            {ambiguity.items.length > 0 ? (
              <SectionTitle level={3}>Déjà en stock</SectionTitle>
            ) : null}
            {ambiguity.items.map((item) => (
              <Button
                disabled={pending}
                key={item.item_id}
                label={`${item.name} · ${LOCATION_LABELS[item.location]}, ${existingAmount(item.amount)}`}
                onPress={() => submit({ item_id: item.item_id })}
                variant="secondary"
              />
            ))}
            {ambiguity.candidates.length > 0 ? (
              <SectionTitle level={3}>Aliments de référence</SectionTitle>
            ) : null}
            {ambiguity.candidates.map((candidate) => (
              <Button
                disabled={pending}
                key={candidate.food_ref_id}
                label={candidate.name}
                onPress={() => submit({ food_ref_id: candidate.food_ref_id })}
                variant="secondary"
              />
            ))}
            {ambiguity.reason === "food" ? (
              <Button
                disabled={pending}
                label={hasNoMatch(ambiguity) ? "Ajouter quand même" : "Aucun ne correspond"}
                onPress={() => submit({ food_ref_id: null })}
                variant={hasNoMatch(ambiguity) ? "secondary" : "quiet"}
              />
            ) : null}
          </View>
        ) : null}

        <Button busy={pending} label="Ajouter" onPress={() => submit()} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, alignItems: "center" },
  column: { width: "100%", maxWidth: 720, gap: spacing.md },
  choices: { gap: spacing.sm },
});
