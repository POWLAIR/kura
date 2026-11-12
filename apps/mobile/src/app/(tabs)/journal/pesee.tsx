import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, View } from "react-native";
import { Button, Field, Notice } from "@/components/ui";
import { fetchWeight } from "@/journal/data";
import {
  type WeightForm,
  type WeightRow,
  weightChangesOf,
  weightFormOf,
  weightInputOf,
  whenNow,
} from "@/journal/forms";
import { callApi } from "@/lib/api";
import { errorMessage, NETWORK_MESSAGE } from "@/lib/api-error";
import { confirm } from "@/lib/confirm";
import { newIdempotencyKey } from "@/lib/idempotency";
import { today } from "@/lib/today";
import { spacing, usePalette } from "@/theme";

// Saisir une pesée, ou corriger celle dont l'id est donné. Mêmes opérations que les tools
// log_weight, update_weight et delete_entry. Aucun commentaire sur le poids : un chiffre et
// une date, rien d'autre.
export default function WeightScreen() {
  const palette = usePalette();
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string; day?: string }>();
  const id = params.id ? Number(params.id) : null;

  const [row, setRow] = useState<WeightRow | null>(null);
  const [form, setForm] = useState<WeightForm | null>(() =>
    id === null ? { ...whenNow(params.day ?? today(), new Date()), weight: "" } : null,
  );
  const [key] = useState(() => newIdempotencyKey("pesee"));
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [missing, setMissing] = useState<string | null>(null);

  useEffect(() => {
    if (id === null) return;
    let current = true;
    fetchWeight(id)
      .then((found) => {
        if (!current) return;
        if (found) {
          setRow(found);
          setForm(weightFormOf(found));
        } else setMissing("Cette pesée n'existe plus.");
      })
      .catch(() => current && setMissing(NETWORK_MESSAGE));
    return () => {
      current = false;
    };
  }, [id]);

  if (missing || !form) {
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

  const set = (changes: Partial<WeightForm>) =>
    setForm((previous) => previous && { ...previous, ...changes });

  async function run(action: () => Promise<unknown>) {
    setPending(true);
    setProblem(null);
    try {
      await action();
      router.back();
    } catch (error) {
      setProblem(errorMessage(error));
      setPending(false);
    }
  }

  function save() {
    if (!form) return;
    if (row) {
      const changes = weightChangesOf(row, form, today());
      if (!changes.ok) return setProblem(changes.message);
      const input = changes.value;
      if (input === null) return router.back();
      return run(() => callApi("update_weight", input));
    }
    const input = weightInputOf(form, today(), key);
    if (!input.ok) return setProblem(input.message);
    return run(() => callApi("log_weight", input.value));
  }

  async function remove() {
    if (!row) return;
    if (!(await confirm("Supprimer cette pesée ?", "Elle disparaît du journal.", "Supprimer")))
      return;
    await run(() => callApi("delete_entry", { kind: "weight", id: row.id }));
  }

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      style={{ backgroundColor: palette.background }}
    >
      <View style={styles.column}>
        <Field
          inputMode="decimal"
          label="Poids (kg)"
          onChangeText={(weight) => set({ weight })}
          placeholder="72,4"
          value={form.weight}
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
              placeholder="8h"
              value={form.time}
            />
          </View>
        </View>

        {problem ? <Notice problem>{problem}</Notice> : null}
        <Button busy={pending} label="Enregistrer" onPress={save} />
        {row ? (
          <Button disabled={pending} label="Supprimer la pesée" onPress={remove} variant="quiet" />
        ) : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, alignItems: "center" },
  column: { width: "100%", maxWidth: 720, gap: spacing.md },
  inline: { flexDirection: "row", gap: spacing.sm },
  grow: { flex: 1 },
});
