import { expiringSoon, expiryLabel, formatAmount, timelineOf } from "@kura/core";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Companion } from "@/components/companion";
import { Screen } from "@/components/screen";
import { Button, Notice, SectionTitle, Tag } from "@/components/ui";
import { useInventory } from "@/inventory/use-inventory";
import { type DayView, fetchDay } from "@/journal/data";
import { errorMessage } from "@/lib/api-error";
import { supabase } from "@/lib/supabase";
import { today } from "@/lib/today";
import { spacing, usePalette } from "@/theme";

const longDate = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "Europe/Paris",
  weekday: "long",
  day: "numeric",
  month: "long",
});

// Accueil : le compagnon provisoire, le résumé du jour et les produits à surveiller. Des
// faits sur la cuisine et la journée, sans objectif ni commentaire sur ce qui a été mangé.
export default function HomeScreen() {
  const palette = usePalette();
  const router = useRouter();
  const inventory = useInventory();
  const [day, setDay] = useState<DayView | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const now = today();

  useFocusEffect(
    useCallback(() => {
      let current = true;
      fetchDay(today())
        .then((view) => {
          if (!current) return;
          setDay(view);
          setProblem(null);
        })
        .catch((error) => current && setProblem(errorMessage(error)));
      return () => {
        current = false;
      };
    }, []),
  );

  const toWatch = expiringSoon(inventory.items, now);
  const entries = day ? timelineOf(day.summary) : [];
  const meals = day?.summary.meals.length ?? 0;
  const [first] = toWatch;

  return (
    <Screen title="Accueil">
      <View style={styles.hero}>
        <Companion />
        <View style={styles.heroText}>
          <Text style={{ color: palette.textSecondary }}>{longDate.format(new Date())}</Text>
          <Text style={[styles.greeting, { color: palette.text }]}>
            {first
              ? `« ${first.name} » attend son tour. On le cuisine ?`
              : "Tout est en ordre dans la cuisine."}
          </Text>
        </View>
      </View>

      <SectionTitle>Aujourd'hui</SectionTitle>
      {problem ? <Notice problem>{problem}</Notice> : null}
      {!day && !problem ? <ActivityIndicator color={palette.accent} /> : null}
      {day ? (
        <Pressable
          accessibilityHint="Ouvre le journal"
          accessibilityRole="button"
          onPress={() => router.push("/journal")}
          style={({ pressed }) => [
            styles.card,
            { backgroundColor: palette.surface, borderColor: palette.border },
            pressed && { opacity: 0.8 },
          ]}
        >
          {entries.length === 0 ? (
            <Text style={{ color: palette.textSecondary }}>
              Rien de noté pour l'instant. Le journal t'attend, ou dis-le à Claude.
            </Text>
          ) : (
            <>
              {entries.map((entry) => (
                <View key={`${entry.kind}-${entry.id}`} style={styles.entry}>
                  <Text style={[styles.time, { color: palette.textSecondary }]}>{entry.time}</Text>
                  <Text style={{ color: palette.text, flex: 1 }}>
                    {entry.kind === "weight" ? "Pesée" : entry.title}
                    {entry.kind === "workout" && entry.detail ? ` · ${entry.detail}` : ""}
                  </Text>
                </View>
              ))}
              <Text style={[styles.note, { color: palette.textSecondary }]}>
                {[
                  meals > 0 ? `${meals} repas` : null,
                  day.summary.workout_minutes > 0
                    ? `${day.summary.workout_minutes} min de sport`
                    : null,
                  "le détail est dans le journal",
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </Text>
            </>
          )}
        </Pressable>
      ) : null}

      <SectionTitle>À surveiller</SectionTitle>
      {inventory.loading ? <ActivityIndicator color={palette.accent} /> : null}
      {inventory.error ? <Notice problem>{inventory.error}</Notice> : null}
      {!inventory.loading && !inventory.error && toWatch.length === 0 ? (
        <Text style={{ color: palette.textSecondary }}>Rien ne périme dans les trois jours.</Text>
      ) : null}
      {toWatch.map((item) => (
        <Pressable
          accessibilityHint="Ouvre la fiche de l'article"
          accessibilityLabel={`${item.name}, ${expiryLabel(item.expires_on, now)}`}
          accessibilityRole="button"
          key={item.id}
          onPress={() =>
            router.push({ pathname: "/cuisine/[id]", params: { id: String(item.id) } })
          }
          style={({ pressed }) => [
            styles.card,
            styles.watch,
            { backgroundColor: palette.surface, borderColor: palette.border },
            pressed && { opacity: 0.8 },
          ]}
        >
          <View style={{ flex: 1, gap: spacing.xs }}>
            <Text style={[styles.name, { color: palette.text }]}>{item.name}</Text>
            <Text style={{ color: palette.textSecondary }}>{formatAmount(item)}</Text>
          </View>
          <Tag strong>{expiryLabel(item.expires_on, now) ?? ""}</Tag>
        </Pressable>
      ))}

      <View style={styles.footer}>
        <Button label="Se déconnecter" onPress={() => supabase.auth.signOut()} variant="quiet" />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  heroText: { flex: 1, gap: spacing.xs },
  greeting: { fontSize: 18, fontWeight: "500", lineHeight: 26 },
  card: { borderWidth: 1, borderRadius: 12, padding: spacing.md, gap: spacing.sm },
  watch: { flexDirection: "row", alignItems: "center" },
  entry: { flexDirection: "row", gap: spacing.md },
  time: { width: 48, fontVariant: ["tabular-nums"] },
  note: { fontSize: 13, lineHeight: 18 },
  name: { fontSize: 16, fontWeight: "500" },
  footer: { marginTop: spacing.lg, alignItems: "flex-start" },
});
