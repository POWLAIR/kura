import { recipeRequestText } from "@kura/core";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Linking, ScrollView, StyleSheet, Text, View } from "react-native";
import { Button, Choice, Field, Notice } from "@/components/ui";
import { claudeChatUrl } from "@/lib/claude";
import { spacing, usePalette } from "@/theme";

const TIMES = [
  { value: "any", label: "Peu importe" },
  { value: "15", label: "15 min" },
  { value: "30", label: "30 min" },
  { value: "45", label: "45 min" },
  { value: "60", label: "1 h" },
] as const;
const SERVINGS = [
  { value: "1", label: "1" },
  { value: "2", label: "2" },
  { value: "3", label: "3" },
  { value: "4", label: "4" },
] as const;

type Time = (typeof TIMES)[number]["value"];
type Servings = (typeof SERVINGS)[number]["value"];

// « Qu'est-ce que je mange ? » : Claude propose trois recettes depuis le stock, avec le
// connecteur Kura et l'abonnement de l'utilisateur ; l'app ne génère rien (issue #79). La
// recette choisie est enregistrée par save_recipe et revient dans l'onglet Recettes.
export default function ProposeScreen() {
  const palette = usePalette();
  const router = useRouter();
  const [time, setTime] = useState<Time>("any");
  const [servings, setServings] = useState<Servings>("2");
  const [craving, setCraving] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [opened, setOpened] = useState(false);

  async function askClaude() {
    setProblem(null);
    const text = recipeRequestText({
      servings: Number(servings),
      ...(time !== "any" && { max_minutes: Number(time) }),
      ...(craving.trim() && { craving: craving.trim().slice(0, 200) }),
    });
    try {
      await Linking.openURL(claudeChatUrl(text));
      setOpened(true);
    } catch {
      setProblem("Impossible d'ouvrir Claude depuis cet appareil.");
    }
  }

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      style={{ backgroundColor: palette.background }}
    >
      <View style={styles.column}>
        <Text style={{ color: palette.textSecondary }}>
          Claude regarde ce qu'il y a dans ta cuisine et propose trois recettes, celles qui
          utilisent ce qui périme bientôt d'abord. Celle que tu choisis arrive dans tes recettes.
        </Text>
        <Choice label="Temps disponible" onChange={setTime} options={TIMES} value={time} />
        <Choice label="Portions" onChange={setServings} options={SERVINGS} value={servings} />
        <Field
          label="Une envie ? (facultatif)"
          maxLength={200}
          onChangeText={setCraving}
          placeholder="quelque chose d'asiatique"
          value={craving}
        />
        <Button label="Demander à Claude" onPress={askClaude} />
        {problem ? <Notice problem>{problem}</Notice> : null}
        {opened ? (
          <>
            <Notice>
              Une fois la recette choisie dans Claude, elle t'attend dans l'onglet Recettes.
            </Notice>
            <Button
              label="Voir mes recettes"
              variant="secondary"
              onPress={() => router.push("/recettes")}
            />
          </>
        ) : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, alignItems: "center" },
  column: { width: "100%", maxWidth: 720, gap: spacing.md },
});
