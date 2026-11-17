import type { ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  View,
} from "react-native";
import { spacing, usePalette } from "@/theme";

// Briques d'interface de l'app. Ni rouge ni vert : l'accent et le texte portent le sens.

export function Button(props: {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "quiet";
  disabled?: boolean;
  busy?: boolean;
}) {
  const palette = usePalette();
  const variant = props.variant ?? "primary";
  const inactive = props.disabled === true || props.busy === true;
  const color = variant === "primary" ? palette.onAccent : palette.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy: props.busy === true }}
      disabled={inactive}
      onPress={props.onPress}
      style={({ pressed }) => [
        styles.button,
        variant === "primary" && { backgroundColor: palette.accent },
        variant === "secondary" && { borderWidth: 1, borderColor: palette.border },
        { opacity: inactive ? 0.5 : pressed ? 0.8 : 1 },
      ]}
    >
      {props.busy ? <ActivityIndicator color={color} size="small" /> : null}
      <Text style={[styles.buttonLabel, { color }]}>{props.label}</Text>
    </Pressable>
  );
}

// Choix unique parmi quelques options, en pastilles.
export function Choice<T extends string>(props: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T | null;
  onChange: (value: T) => void;
}) {
  const palette = usePalette();
  return (
    <View accessibilityLabel={props.label} accessibilityRole="radiogroup" style={styles.field}>
      <Text style={[styles.label, { color: palette.textSecondary }]}>{props.label}</Text>
      <View style={styles.chips}>
        {props.options.map((option) => {
          const selected = option.value === props.value;
          return (
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ selected, checked: selected }}
              key={option.value}
              onPress={() => props.onChange(option.value)}
              style={[
                styles.chip,
                {
                  backgroundColor: selected ? palette.accent : palette.surface,
                  borderColor: selected ? palette.accent : palette.border,
                },
              ]}
            >
              <Text style={{ color: selected ? palette.onAccent : palette.text }}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function Field(props: { label: string; hint?: string } & TextInputProps) {
  const palette = usePalette();
  const { label, hint, style, ...input } = props;
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: palette.textSecondary }]}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={palette.textSecondary}
        style={[
          styles.input,
          { backgroundColor: palette.surface, borderColor: palette.border, color: palette.text },
          style,
        ]}
        {...input}
      />
      {hint ? <Text style={[styles.hint, { color: palette.textSecondary }]}>{hint}</Text> : null}
    </View>
  );
}

// Message à l'utilisateur : une information, ou un problème à corriger.
export function Notice(props: { children: ReactNode; problem?: boolean }) {
  const palette = usePalette();
  return (
    <View
      accessibilityRole={props.problem ? "alert" : "summary"}
      style={[
        styles.notice,
        { backgroundColor: palette.accentSoft, borderColor: palette.accent },
        props.problem && { borderLeftWidth: 4 },
      ]}
    >
      <Text style={{ color: palette.text, lineHeight: 22 }}>{props.children}</Text>
    </View>
  );
}

export function SectionTitle(props: { children: string; level?: 2 | 3 }) {
  const palette = usePalette();
  const small = props.level === 3;
  return (
    <Text
      accessibilityRole="header"
      style={
        small
          ? [styles.subsection, { color: palette.textSecondary }]
          : [styles.section, { color: palette.text }]
      }
    >
      {props.children}
    </Text>
  );
}

// Étiquette courte posée sur une ligne (« À racheter », « Périme demain »).
export function Tag(props: { children: string; strong?: boolean }) {
  const palette = usePalette();
  return (
    <View
      style={[
        styles.tag,
        props.strong
          ? { backgroundColor: palette.accent }
          : { backgroundColor: palette.accentSoft },
      ]}
    >
      <Text style={[styles.tagLabel, { color: props.strong ? palette.onAccent : palette.text }]}>
        {props.children}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: "row",
    gap: spacing.sm,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
  },
  buttonLabel: { fontSize: 16, fontWeight: "600" },
  field: { gap: spacing.xs },
  label: { fontSize: 14, fontWeight: "500" },
  hint: { fontSize: 13, lineHeight: 18 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: spacing.sm,
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    fontSize: 16,
  },
  notice: { borderRadius: 12, borderWidth: 1, padding: spacing.md },
  section: { fontSize: 20, fontWeight: "600", marginTop: spacing.sm },
  subsection: { fontSize: 13, fontWeight: "600", letterSpacing: 0.6, textTransform: "uppercase" },
  tag: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  tagLabel: { fontSize: 12, fontWeight: "600" },
});
