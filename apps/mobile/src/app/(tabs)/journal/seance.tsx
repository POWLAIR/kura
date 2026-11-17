import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, View } from "react-native";
import { Button, Choice, Field, Notice } from "@/components/ui";
import { fetchWorkout } from "@/journal/data";
import {
  type WorkoutForm,
  type WorkoutRow,
  whenNow,
  workoutChangesOf,
  workoutFormOf,
  workoutInputOf,
} from "@/journal/forms";
import { callApi } from "@/lib/api";
import { errorMessage, NETWORK_MESSAGE } from "@/lib/api-error";
import { confirm } from "@/lib/confirm";
import { createKeyring, withKey } from "@/lib/idempotency";
import { today } from "@/lib/today";
import { spacing, usePalette } from "@/theme";

const INTENSITY_OPTIONS = [
  { value: "1", label: "1 · facile" },
  { value: "2", label: "2" },
  { value: "3", label: "3" },
  { value: "4", label: "4" },
  { value: "5", label: "5 · très dur" },
] as const;

// Saisir une séance, ou corriger celle dont l'id est donné. Mêmes opérations que les tools
// log_workout, update_workout et delete_entry.
export default function WorkoutScreen() {
  const palette = usePalette();
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string; day?: string }>();
  const id = params.id ? Number(params.id) : null;

  const [row, setRow] = useState<WorkoutRow | null>(null);
  const [form, setForm] = useState<WorkoutForm | null>(() =>
    id === null
      ? {
          ...whenNow(params.day ?? today(), new Date()),
          type: "",
          duration: "",
          intensity: null,
          notes: "",
        }
      : null,
  );
  const [keyring] = useState(() => createKeyring("seance"));
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [missing, setMissing] = useState<string | null>(null);

  useEffect(() => {
    if (id === null) return;
    let current = true;
    fetchWorkout(id)
      .then((found) => {
        if (!current) return;
        if (found) {
          setRow(found);
          setForm(workoutFormOf(found));
        } else setMissing("Cette séance n'existe plus.");
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

  const set = (changes: Partial<WorkoutForm>) =>
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
      const changes = workoutChangesOf(row, form, today());
      if (!changes.ok) return setProblem(changes.message);
      const input = changes.value;
      if (input === null) return router.back();
      return run(() => callApi("update_workout", input));
    }
    const input = workoutInputOf(form, today(), "cle-a-venir");
    if (!input.ok) return setProblem(input.message);
    return run(() => callApi("log_workout", withKey(keyring, input.value)));
  }

  async function remove() {
    if (!row) return;
    if (!(await confirm("Supprimer cette séance ?", "Elle disparaît du journal.", "Supprimer")))
      return;
    await run(() => callApi("delete_entry", { kind: "workout", id: row.id }));
  }

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      style={{ backgroundColor: palette.background }}
    >
      <View style={styles.column}>
        <Field
          label="Activité"
          onChangeText={(type) => set({ type })}
          placeholder="vélo, course, yoga…"
          value={form.type}
        />
        <Field
          inputMode="numeric"
          label="Durée (minutes)"
          onChangeText={(duration) => set({ duration })}
          value={form.duration}
        />
        <Choice
          label="Intensité ressentie (touche à nouveau pour l'effacer)"
          onChange={(value) =>
            set({ intensity: Number(value) === form.intensity ? null : Number(value) })
          }
          options={INTENSITY_OPTIONS}
          value={form.intensity === null ? null : (String(form.intensity) as "1")}
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
              label="Heure de début"
              onChangeText={(time) => set({ time })}
              placeholder="18h30"
              value={form.time}
            />
          </View>
        </View>
        <Field
          label="Notes"
          multiline
          onChangeText={(notes) => set({ notes })}
          value={form.notes}
        />

        {problem ? <Notice problem>{problem}</Notice> : null}
        <Button busy={pending} label="Enregistrer" onPress={save} />
        {row ? (
          <Button disabled={pending} label="Supprimer la séance" onPress={remove} variant="quiet" />
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
