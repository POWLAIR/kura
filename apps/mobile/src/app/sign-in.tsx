import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { supabase } from "@/lib/supabase";
import { spacing, usePalette } from "@/theme";

// Connexion par email et mot de passe. Le compte est créé à la main dans Supabase
// (inscriptions fermées, voir docs/deploiement.md) : pas d'écran d'inscription.
export default function SignInScreen() {
  const palette = usePalette();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready = email.trim().length > 0 && password.length > 0 && !pending;

  async function signIn() {
    if (!ready) return;
    setPending(true);
    setError(null);
    const { error: failure } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setPending(false);
    // En cas de succès, la session change et la navigation bascule sur les onglets.
    if (failure) {
      setError(
        failure.status === 400
          ? "Email ou mot de passe incorrect."
          : "Connexion impossible pour l'instant. Réessaie dans un moment.",
      );
    }
  }

  const input = [
    styles.input,
    { backgroundColor: palette.surface, borderColor: palette.border, color: palette.text },
  ];
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={[styles.page, { backgroundColor: palette.background }]}
    >
      <View style={styles.form}>
        <Text accessibilityRole="header" style={[styles.title, { color: palette.text }]}>
          Kura
        </Text>
        <Text style={{ color: palette.textSecondary }}>Connecte-toi pour ouvrir ta cuisine.</Text>
        <TextInput
          accessibilityLabel="Email"
          autoCapitalize="none"
          autoComplete="email"
          inputMode="email"
          onChangeText={setEmail}
          placeholder="Email"
          placeholderTextColor={palette.textSecondary}
          style={input}
          value={email}
        />
        <TextInput
          accessibilityLabel="Mot de passe"
          autoComplete="current-password"
          onChangeText={setPassword}
          onSubmitEditing={signIn}
          placeholder="Mot de passe"
          placeholderTextColor={palette.textSecondary}
          secureTextEntry
          style={input}
          value={password}
        />
        {error ? (
          <Text accessibilityRole="alert" style={{ color: palette.text }}>
            {error}
          </Text>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: !ready }}
          disabled={!ready}
          onPress={signIn}
          style={[styles.button, { backgroundColor: palette.accent, opacity: ready ? 1 : 0.5 }]}
        >
          <Text style={[styles.buttonLabel, { color: palette.onAccent }]}>
            {pending ? "Connexion…" : "Se connecter"}
          </Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, justifyContent: "center", alignItems: "center", padding: spacing.lg },
  form: { width: "100%", maxWidth: 400, gap: spacing.md },
  title: { fontSize: 40, fontWeight: "600" },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    fontSize: 16,
  },
  button: { borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  buttonLabel: { fontSize: 16, fontWeight: "600" },
});
