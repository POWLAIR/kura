import {
  type ApiKeyView,
  type CreatedApiKey,
  type DataExport,
  DELETE_ACCOUNT_WORD,
  localDate,
} from "@kura/core";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { Button, Field, Notice, SectionTitle, Tag } from "@/components/ui";
import { callApi, callDeleteAccount } from "@/lib/api";
import { errorMessage, NETWORK_MESSAGE } from "@/lib/api-error";
import { confirm } from "@/lib/confirm";
import { saveTextFile } from "@/lib/save-file";
import { supabase, supabaseUrl } from "@/lib/supabase";
import { spacing, usePalette } from "@/theme";

const COLUMNS = "id, label, key_prefix, created_at, last_used_at, revoked_at";

const dateTime = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "Europe/Paris",
  day: "numeric",
  month: "long",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
const when = (iso: string) => dateTime.format(new Date(iso));

// Réglages : les clés du connecteur Claude (serveur MCP), l'export de ses données, la
// déconnexion et la suppression du compte.
// Une clé n'est affichée qu'à sa création ; seul son hash est gardé en base.
export default function SettingsScreen() {
  const palette = usePalette();
  const [keys, setKeys] = useState<ApiKeyView[] | null>(null);
  const [label, setLabel] = useState("");
  const [created, setCreated] = useState<CreatedApiKey | null>(null);
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [exported, setExported] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [word, setWord] = useState("");

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("api_key")
      .select(COLUMNS)
      .order("created_at", { ascending: false });
    if (error) setProblem(NETWORK_MESSAGE);
    else setKeys(data);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function create() {
    if (label.trim() === "") {
      setProblem("Donne un nom à la clé, par exemple « Claude mobile ».");
      return;
    }
    setPending(true);
    setProblem(null);
    try {
      setCreated(await callApi<CreatedApiKey>("create_api_key", { label }));
      setLabel("");
      await load();
    } catch (error) {
      setProblem(errorMessage(error));
    } finally {
      setPending(false);
    }
  }

  async function revoke(key: ApiKeyView) {
    const confirmed = await confirm(
      `Révoquer « ${key.label} » ?`,
      "Claude ne pourra plus se connecter avec cette clé. Elle ne pourra pas être réactivée.",
      "Révoquer",
    );
    if (!confirmed) return;
    setPending(true);
    setProblem(null);
    try {
      await callApi("revoke_api_key", { id: key.id });
      await load();
    } catch (error) {
      setProblem(errorMessage(error));
    } finally {
      setPending(false);
    }
  }

  async function exportAll() {
    setPending(true);
    setProblem(null);
    try {
      const data = await callApi<DataExport>("export_data");
      const name = `kura-export-${localDate(new Date())}.json`;
      await saveTextFile(name, JSON.stringify(data, null, 2), "application/json");
      setExported(name);
    } catch (error) {
      setProblem(errorMessage(error));
    } finally {
      setPending(false);
    }
  }

  async function deleteAccount() {
    if (word.trim() !== DELETE_ACCOUNT_WORD) {
      setProblem(`Tape ${DELETE_ACCOUNT_WORD} pour confirmer.`);
      return;
    }
    setPending(true);
    setProblem(null);
    try {
      await callDeleteAccount(DELETE_ACCOUNT_WORD);
      // Le compte n'existe plus : on efface seulement la session gardée sur l'appareil.
      await supabase.auth.signOut({ scope: "local" });
    } catch (error) {
      setProblem(errorMessage(error));
      setPending(false);
    }
  }

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      style={{ backgroundColor: palette.background }}
    >
      <View style={styles.column}>
        <SectionTitle>Connecteur Claude</SectionTitle>
        <Text style={{ color: palette.textSecondary, lineHeight: 22 }}>
          Une clé permet à Claude d'utiliser Kura : inventaire, repas, séances. Crée une clé par
          appareil ou par usage, pour pouvoir en révoquer une sans toucher aux autres.
        </Text>
        <Text selectable style={{ color: palette.textSecondary, lineHeight: 22 }}>
          Adresse du connecteur : {supabaseUrl}/functions/v1/mcp
        </Text>

        {created ? (
          <View style={styles.created}>
            <Notice>
              Voici la clé « {created.key.label} ». Copie-la maintenant dans le connecteur : elle ne
              sera plus jamais affichée.
            </Notice>
            <Text
              accessibilityLabel="Clé à copier"
              selectable
              style={[
                styles.secret,
                {
                  backgroundColor: palette.surface,
                  borderColor: palette.border,
                  color: palette.text,
                },
              ]}
            >
              {created.secret}
            </Text>
            <Button
              label="J'ai copié la clé"
              onPress={() => setCreated(null)}
              variant="secondary"
            />
          </View>
        ) : (
          <View style={styles.inline}>
            <View style={styles.grow}>
              <Field
                label="Nom de la nouvelle clé"
                onChangeText={setLabel}
                onSubmitEditing={create}
                placeholder="Claude mobile"
                value={label}
              />
            </View>
            <Button busy={pending} label="Créer une clé" onPress={create} />
          </View>
        )}

        {problem ? <Notice problem>{problem}</Notice> : null}
        {keys === null && !problem ? <ActivityIndicator color={palette.accent} /> : null}
        {keys?.length === 0 ? (
          <Text style={{ color: palette.textSecondary }}>Aucune clé pour l'instant.</Text>
        ) : null}
        {keys?.map((key) => (
          <View
            accessibilityLabel={`Clé ${key.label}`}
            key={key.id}
            style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}
          >
            <View style={styles.cardHead}>
              <Text style={[styles.name, { color: palette.text }]}>{key.label}</Text>
              {key.revoked_at ? <Tag>Révoquée</Tag> : null}
            </View>
            <Text style={{ color: palette.textSecondary }}>{key.key_prefix}…</Text>
            <Text style={{ color: palette.textSecondary }}>Créée le {when(key.created_at)}</Text>
            <Text style={{ color: palette.textSecondary }}>
              {key.last_used_at
                ? `Dernière utilisation le ${when(key.last_used_at)}`
                : "Jamais utilisée"}
            </Text>
            {key.revoked_at ? (
              <Text style={{ color: palette.textSecondary }}>
                Révoquée le {when(key.revoked_at)}
              </Text>
            ) : (
              <Button
                disabled={pending}
                label="Révoquer"
                onPress={() => revoke(key)}
                variant="quiet"
              />
            )}
          </View>
        ))}

        <SectionTitle>Mes données</SectionTitle>
        <Text style={{ color: palette.textSecondary, lineHeight: 22 }}>
          L'export contient tout ce que Kura garde sur toi : inventaire, mouvements de stock, repas,
          séances, pesées, recettes, conversions et clés (sans leur secret), dans un fichier JSON.
        </Text>
        <Button
          busy={pending && !deleting}
          label="Exporter mes données"
          onPress={exportAll}
          variant="secondary"
        />
        {exported ? <Notice>{`Export prêt : ${exported}.`}</Notice> : null}

        <SectionTitle>Compte</SectionTitle>
        <Button
          label="Se déconnecter"
          onPress={() => supabase.auth.signOut()}
          variant="secondary"
        />
        {deleting ? (
          <View style={styles.created}>
            <Notice problem>
              Supprimer le compte efface définitivement toutes tes données : inventaire, repas,
              séances, pesées, recettes, clés. Rien ne pourra être récupéré. Pense à exporter
              d'abord.
            </Notice>
            <Field
              autoCapitalize="characters"
              label={`Tape ${DELETE_ACCOUNT_WORD} pour confirmer`}
              onChangeText={setWord}
              value={word}
            />
            <Button
              busy={pending}
              label="Supprimer définitivement mon compte"
              onPress={deleteAccount}
            />
            <Button
              disabled={pending}
              label="Annuler"
              onPress={() => {
                setDeleting(false);
                setWord("");
              }}
              variant="quiet"
            />
          </View>
        ) : (
          <Button label="Supprimer mon compte…" onPress={() => setDeleting(true)} variant="quiet" />
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, alignItems: "center" },
  column: { width: "100%", maxWidth: 720, gap: spacing.md },
  inline: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm },
  grow: { flex: 1 },
  created: { gap: spacing.sm },
  secret: {
    borderWidth: 1,
    borderRadius: 12,
    padding: spacing.md,
    fontFamily: "monospace",
    fontSize: 15,
  },
  card: { borderWidth: 1, borderRadius: 12, padding: spacing.md, gap: spacing.xs },
  cardHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  name: { fontSize: 16, fontWeight: "600", flexShrink: 1 },
});
