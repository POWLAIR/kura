import type { OAuthGrant } from "@supabase/supabase-js";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Button, Notice, SectionTitle } from "@/components/ui";
import { confirm } from "@/lib/confirm";
import { supabase } from "@/lib/supabase";
import { spacing, usePalette } from "@/theme";

const day = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "Europe/Paris",
  day: "numeric",
  month: "long",
  year: "numeric",
});

// Applications autorisées par OAuth à utiliser Kura en ton nom (le connecteur claude.ai,
// issue #38). Retirer l'accès révoque aussi leurs sessions. Si le serveur OAuth n'est pas
// activé sur le projet, la section ne s'affiche pas.
export function ConnectedApps() {
  const palette = usePalette();
  const [grants, setGrants] = useState<OAuthGrant[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.auth.oauth.listGrants();
    setGrants(error ? null : data);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function revoke(grant: OAuthGrant) {
    const confirmed = await confirm(
      `Retirer l'accès de « ${grant.client.name} » ?`,
      "Cette application ne pourra plus utiliser Kura en ton nom ; il faudra l'autoriser de nouveau.",
      "Retirer",
    );
    if (!confirmed) return;
    setPending(true);
    setProblem(null);
    const { error } = await supabase.auth.oauth.revokeGrant({ clientId: grant.client.id });
    if (error) setProblem("Retrait impossible pour l'instant. Réessaie dans un moment.");
    await load();
    setPending(false);
  }

  if (grants === null) return null;
  return (
    <>
      <SectionTitle>Applications connectées</SectionTitle>
      <Text style={{ color: palette.textSecondary, lineHeight: 20 }}>
        Les applications autorisées à utiliser Kura en ton nom, comme le connecteur Claude connecté
        sans clé.
      </Text>
      {problem ? <Notice problem>{problem}</Notice> : null}
      {grants.length === 0 ? (
        <Text style={{ color: palette.textSecondary }}>Aucune application connectée.</Text>
      ) : null}
      {grants.map((grant) => (
        <View
          key={grant.client.id}
          style={[styles.row, { backgroundColor: palette.surface, borderColor: palette.border }]}
        >
          <View style={{ flex: 1, gap: spacing.xs }}>
            <Text style={{ color: palette.text, fontWeight: "500" }}>
              {grant.client.name || "Application sans nom"}
            </Text>
            <Text style={{ color: palette.textSecondary, fontSize: 13 }}>
              {`Autorisée le ${day.format(new Date(grant.granted_at))}`}
            </Text>
          </View>
          <Button
            disabled={pending}
            label="Retirer"
            onPress={() => revoke(grant)}
            variant="secondary"
          />
        </View>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  row: {
    borderWidth: 1,
    borderRadius: 12,
    padding: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
});
