import type { OAuthAuthorizationDetails } from "@supabase/supabase-js";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import SignInScreen from "@/app/sign-in";
import { useSession } from "@/auth/session";
import { Button, Notice } from "@/components/ui";
import { supabase } from "@/lib/supabase";
import { spacing, usePalette } from "@/theme";

const SCOPE_LABELS: Record<string, string> = {
  openid: "te reconnaître",
  email: "voir ton adresse email",
  profile: "voir ton profil",
  offline_access: "rester connecté sans te redemander",
};

// Retour à l'application cliente, dans le même onglet sur le web (Linking ouvrirait un
// nouvel onglet et laisserait le client OAuth sans réponse).
function returnTo(url: string) {
  if (Platform.OS === "web") window.location.assign(url);
  else Linking.openURL(url);
}

// Écran de consentement du serveur OAuth 2.1 de Supabase Auth (issue #38) : une application
// (le connecteur claude.ai) demande à agir en ton nom sur Kura. Supabase y envoie avec
// ?authorization_id=… ; sans session, on se connecte d'abord ici même.
export default function ConsentScreen() {
  const palette = usePalette();
  const { session } = useSession();
  const { authorization_id: authorizationId } = useLocalSearchParams<{
    authorization_id?: string;
  }>();
  const [details, setDetails] = useState<OAuthAuthorizationDetails | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!session || !authorizationId) return;
    let current = true;
    supabase.auth.oauth.getAuthorizationDetails(authorizationId).then(({ data, error }) => {
      if (!current) return;
      if (error || !data) {
        setProblem("Cette demande a expiré ou n'existe pas. Relance la connexion depuis Claude.");
      } else if ("authorization_id" in data) {
        setDetails(data);
      } else {
        // Déjà autorisée : retour direct à l'application.
        returnTo(data.redirect_url);
      }
    });
    return () => {
      current = false;
    };
  }, [session, authorizationId]);

  async function decide(approve: boolean) {
    if (!authorizationId) return;
    setPending(true);
    setProblem(null);
    const { data, error } = approve
      ? await supabase.auth.oauth.approveAuthorization(authorizationId, {
          skipBrowserRedirect: true,
        })
      : await supabase.auth.oauth.denyAuthorization(authorizationId, {
          skipBrowserRedirect: true,
        });
    if (error || !data) {
      setProblem("Réponse impossible pour l'instant. Réessaie dans un moment.");
      setPending(false);
      return;
    }
    returnTo(data.redirect_url);
  }

  if (!session) return <SignInScreen />;

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      style={{ backgroundColor: palette.background }}
    >
      <View style={styles.column}>
        <Text accessibilityRole="header" style={[styles.title, { color: palette.text }]}>
          Connecter une application à Kura
        </Text>
        {!authorizationId ? (
          <Notice problem>Lien incomplet : relance la connexion depuis Claude.</Notice>
        ) : null}
        {problem ? <Notice problem>{problem}</Notice> : null}
        {authorizationId && !details && !problem ? (
          <ActivityIndicator color={palette.accent} />
        ) : null}
        {details ? (
          <>
            <Text style={{ color: palette.text, fontSize: 17, lineHeight: 24 }}>
              {`« ${details.client.name || "Une application"} » demande à utiliser Kura en ton nom (${details.user.email}).`}
            </Text>
            {details.client.uri ? (
              <Text style={{ color: palette.textSecondary }}>{details.client.uri}</Text>
            ) : null}
            <Text style={{ color: palette.text, lineHeight: 22 }}>
              Elle pourra lire et modifier ton inventaire, tes recettes et ton journal (repas,
              séances, pesées), comme Claude avec une clé API.
            </Text>
            {details.scope ? (
              <Text style={{ color: palette.textSecondary, lineHeight: 20 }}>
                {`Autorisations demandées : ${details.scope
                  .split(" ")
                  .filter(Boolean)
                  .map((scope) => SCOPE_LABELS[scope] ?? scope)
                  .join(", ")}.`}
              </Text>
            ) : null}
            <Text style={{ color: palette.textSecondary, lineHeight: 20 }}>
              Tu pourras retirer cet accès à tout moment dans les réglages.
            </Text>
            <Button busy={pending} label="Autoriser" onPress={() => decide(true)} />
            <Button
              disabled={pending}
              label="Refuser"
              onPress={() => decide(false)}
              variant="secondary"
            />
          </>
        ) : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, alignItems: "center", flexGrow: 1, justifyContent: "center" },
  column: { width: "100%", maxWidth: 520, gap: spacing.md },
  title: { fontSize: 24, fontWeight: "600" },
});
