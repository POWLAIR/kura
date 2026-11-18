import {
  dayLabel,
  nutritionBrief,
  shiftDay,
  shortDayLabel,
  type TimelineEntry,
  timelineOf,
  type WeekSummary,
} from "@kura/core";
import { useFocusEffect, useRouter } from "expo-router";
import { type ReactNode, useCallback, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { NutritionCard } from "@/components/nutrition-card";
import { Screen } from "@/components/screen";
import { Button, Choice, Notice, SectionTitle } from "@/components/ui";
import { type DayView, fetchDay, fetchWeek } from "@/journal/data";
import { errorMessage } from "@/lib/api-error";
import { today } from "@/lib/today";
import { spacing, usePalette } from "@/theme";

type Mode = "day" | "week";
type Loaded =
  | { mode: "day"; date: string; day: DayView }
  | { mode: "week"; date: string; week: WeekSummary };

const decimal = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });

const KIND_LABELS = { meal: "Repas", workout: "Séance", weight: "Pesée" } as const;

export default function JournalScreen() {
  const palette = usePalette();
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("day");
  const [date, setDate] = useState(() => today());
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const now = today();

  const load = useCallback(async () => {
    try {
      setLoaded(
        mode === "day"
          ? { mode, date, day: await fetchDay(date) }
          : { mode, date, week: await fetchWeek(date) },
      );
      setProblem(null);
    } catch (error) {
      setProblem(errorMessage(error));
    }
  }, [mode, date]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // Ce qui est affiché correspond-il au jour et à la vue demandés ?
  const current = loaded !== null && loaded.mode === mode && loaded.date === date ? loaded : null;
  const step = mode === "day" ? 1 : 7;

  const SHEETS = {
    meal: "/journal/fiche-repas",
    workout: "/journal/seance",
    weight: "/journal/pesee",
  } as const;

  function open(entry: TimelineEntry) {
    router.push({ pathname: SHEETS[entry.kind], params: { id: String(entry.id) } });
  }

  // Les totaux, en seconde colonne sur grand écran, sous la frise sinon.
  let aside: ReactNode = null;
  if (current?.mode === "day") {
    const { summary } = current.day;
    aside = (
      <>
        {summary.meals.length > 0 ? (
          <>
            <SectionTitle level={3}>Total des repas</SectionTitle>
            <NutritionCard
              nutrition={summary.nutrition}
              micronutrients={current.day.micronutrients}
            />
          </>
        ) : null}
        {summary.workout_minutes > 0 ? (
          <Text style={{ color: palette.textSecondary }}>
            Sport : {summary.workout_minutes} min.
          </Text>
        ) : null}
      </>
    );
  } else if (current?.mode === "week") {
    aside = (
      <>
        <SectionTitle level={3}>Total de la semaine</SectionTitle>
        <NutritionCard nutrition={current.week.nutrition} />
        <Text style={{ color: palette.textSecondary }}>
          Sport : {current.week.workout_minutes} min.
          {current.week.weight
            ? ` Poids moyen : ${decimal.format(current.week.weight.average_kg)} kg (${current.week.weight.measures} ${current.week.weight.measures > 1 ? "pesées" : "pesée"}).`
            : ""}
        </Text>
      </>
    );
  }

  return (
    <Screen aside={aside} title="Journal">
      <Choice
        label="Affichage"
        onChange={setMode}
        options={[
          { value: "day", label: "Jour" },
          { value: "week", label: "Semaine" },
        ]}
        value={mode}
      />
      <View style={styles.dateBar}>
        <Button
          label={mode === "day" ? "Jour précédent" : "Semaine précédente"}
          onPress={() => setDate(shiftDay(date, -step))}
          variant="secondary"
        />
        <Button
          disabled={shiftDay(date, step) > now && mode === "day"}
          label={mode === "day" ? "Jour suivant" : "Semaine suivante"}
          onPress={() => setDate(shiftDay(date, step) > now ? now : shiftDay(date, step))}
          variant="secondary"
        />
      </View>

      {problem ? (
        <>
          <Notice problem>{problem}</Notice>
          <Button label="Réessayer" onPress={load} variant="secondary" />
        </>
      ) : null}
      {!current && !problem ? <ActivityIndicator color={palette.accent} /> : null}

      {current?.mode === "day" ? (
        <>
          <SectionTitle>{dayLabel(date, now)}</SectionTitle>
          <View style={styles.dateBar}>
            <Button
              label="Repas"
              onPress={() => router.push({ pathname: "/journal/repas", params: { day: date } })}
            />
            <Button
              label="Séance"
              onPress={() => router.push({ pathname: "/journal/seance", params: { day: date } })}
              variant="secondary"
            />
            <Button
              label="Pesée"
              onPress={() => router.push({ pathname: "/journal/pesee", params: { day: date } })}
              variant="secondary"
            />
          </View>

          {timelineOf(current.day.summary).length === 0 ? (
            <Text style={{ color: palette.textSecondary, lineHeight: 22 }}>
              Rien de noté ce jour-là. Ajoute un repas, une séance ou une pesée, ou dis-le à Claude.
            </Text>
          ) : null}
          {timelineOf(current.day.summary).map((entry) => {
            const nutrition = current.day.mealNutrition.get(entry.id);
            const brief = entry.kind === "meal" && nutrition ? nutritionBrief(nutrition) : null;
            return (
              <Pressable
                accessibilityHint={
                  entry.kind === "meal" ? "Ouvre le détail du repas" : "Ouvre pour corriger"
                }
                accessibilityLabel={`${entry.time}, ${KIND_LABELS[entry.kind]}, ${entry.title}${entry.detail ? `, ${entry.detail}` : ""}`}
                accessibilityRole="button"
                key={`${entry.kind}-${entry.id}`}
                onPress={() => open(entry)}
                style={({ pressed }) => [
                  styles.entry,
                  { backgroundColor: palette.surface, borderColor: palette.border },
                  pressed && { opacity: 0.8 },
                ]}
              >
                <Text style={[styles.time, { color: palette.textSecondary }]}>{entry.time}</Text>
                <View style={styles.entryBody}>
                  <Text style={[styles.entryTitle, { color: palette.text }]}>{entry.title}</Text>
                  {brief ? <Text style={{ color: palette.textSecondary }}>{brief}</Text> : null}
                  {entry.detail ? (
                    <Text style={{ color: palette.textSecondary }}>{entry.detail}</Text>
                  ) : null}
                </View>
              </Pressable>
            );
          })}
        </>
      ) : null}

      {current?.mode === "week" ? (
        <>
          <SectionTitle>
            {`Du ${shortDayLabel(current.week.from)} au ${shortDayLabel(current.week.to)}`}
          </SectionTitle>
          {current.week.days.map((day) => (
            <Pressable
              accessibilityHint="Ouvre ce jour"
              accessibilityLabel={`${shortDayLabel(day.date)}, ${day.meals} repas, ${day.workout_minutes} minutes de sport`}
              accessibilityRole="button"
              disabled={day.date > now}
              key={day.date}
              onPress={() => {
                setDate(day.date);
                setMode("day");
              }}
              style={({ pressed }) => [
                styles.entry,
                { backgroundColor: palette.surface, borderColor: palette.border },
                (pressed || day.date > now) && { opacity: 0.6 },
              ]}
            >
              <Text style={[styles.time, { color: palette.textSecondary }]}>
                {shortDayLabel(day.date)}
              </Text>
              <View style={styles.entryBody}>
                <Text style={{ color: palette.text }}>
                  {day.meals === 0 ? "Aucun repas noté" : `${day.meals} repas`}
                  {day.workout_minutes > 0 ? ` · ${day.workout_minutes} min de sport` : ""}
                </Text>
                {day.meals > 0 ? (
                  <Text style={{ color: palette.textSecondary }}>
                    {nutritionBrief(day.nutrition)}
                    {day.nutrition.partial_values ? " · valeurs partielles" : ""}
                  </Text>
                ) : null}
              </View>
            </Pressable>
          ))}
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  dateBar: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  entry: {
    flexDirection: "row",
    gap: spacing.md,
    borderWidth: 1,
    borderRadius: 12,
    padding: spacing.md,
  },
  time: { width: 56, fontSize: 14, fontVariant: ["tabular-nums"] },
  entryBody: { flex: 1, gap: spacing.xs },
  entryTitle: { fontSize: 16, fontWeight: "500" },
});
