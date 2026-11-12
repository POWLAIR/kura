import { expiryLabel, expiryStatus, formatAmount, groupInventory } from "@kura/core";
import { useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Screen } from "@/components/screen";
import { Button, Choice, Notice, SectionTitle, Tag } from "@/components/ui";
import type { InventoryRow } from "@/inventory/item-form";
import { useInventory } from "@/inventory/use-inventory";
import { today } from "@/lib/today";
import { spacing, usePalette } from "@/theme";

type View_ = "stock" | "restock";

// Ligne d'un article : nom, quantité ou niveau, et ce qui mérite l'attention (péremption
// proche, à racheter). Un appui ouvre sa fiche.
function ItemRow({ item, day }: { item: InventoryRow; day: string }) {
  const palette = usePalette();
  const router = useRouter();
  const expiry = expiryStatus(item.expires_on, day);
  const label = expiryLabel(item.expires_on, day);
  const amount = formatAmount(item);
  return (
    <Pressable
      accessibilityHint="Ouvre la fiche de l'article"
      accessibilityLabel={`${item.name}, ${amount}${label ? `, ${label}` : ""}${item.low_stock ? ", à racheter" : ""}`}
      accessibilityRole="button"
      onPress={() => router.push({ pathname: "/cuisine/[id]", params: { id: String(item.id) } })}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: palette.surface, borderColor: palette.border },
        pressed && { opacity: 0.8 },
      ]}
    >
      <View style={styles.rowMain}>
        <Text style={[styles.name, { color: palette.text }]}>{item.name}</Text>
        <Text style={[styles.amount, { color: palette.textSecondary }]}>{amount}</Text>
      </View>
      {label || item.low_stock ? (
        <View style={styles.tags}>
          {label && expiry.kind !== "later" ? <Tag strong>{label}</Tag> : null}
          {label && expiry.kind === "later" ? (
            <Text style={{ color: palette.textSecondary, fontSize: 13 }}>{label}</Text>
          ) : null}
          {item.low_stock ? <Tag>À racheter</Tag> : null}
        </View>
      ) : null}
    </Pressable>
  );
}

export default function KitchenScreen() {
  const palette = usePalette();
  const router = useRouter();
  const { items, loading, error, reload } = useInventory();
  const [view, setView] = useState<View_>("stock");
  const day = today();

  const toRestock = items.filter((item) => item.low_stock);
  const shown = view === "stock" ? items : toRestock;
  const groups = groupInventory(shown);

  return (
    <Screen title="Cuisine">
      <Choice
        label="Affichage"
        onChange={setView}
        options={[
          { value: "stock", label: `Inventaire (${items.length})` },
          { value: "restock", label: `À racheter (${toRestock.length})` },
        ]}
        value={view}
      />
      <Button label="Ajouter un article" onPress={() => router.push("/cuisine/ajouter")} />

      {error ? (
        <>
          <Notice problem>{error}</Notice>
          <Button label="Réessayer" onPress={reload} variant="secondary" />
        </>
      ) : null}
      {loading ? <ActivityIndicator color={palette.accent} /> : null}

      {!loading && !error && shown.length === 0 ? (
        <Text style={{ color: palette.textSecondary, lineHeight: 22 }}>
          {view === "stock"
            ? "L'inventaire est vide. Ajoute un premier article ici, ou dicte tes courses à Claude."
            : "Rien à racheter. Un article apparaît ici quand il passe sous son seuil de rachat, à régler dans sa fiche."}
        </Text>
      ) : null}

      {groups.map((group) => (
        <View key={group.location} style={styles.group}>
          <SectionTitle>{group.label}</SectionTitle>
          {group.categories.map((category) => (
            <View key={category.category} style={styles.category}>
              <SectionTitle level={3}>{category.label}</SectionTitle>
              {category.items.map((item) => (
                <ItemRow day={day} item={item} key={item.id} />
              ))}
            </View>
          ))}
        </View>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  group: { gap: spacing.sm },
  category: { gap: spacing.sm, marginTop: spacing.xs },
  row: { borderWidth: 1, borderRadius: 12, padding: spacing.md, gap: spacing.sm },
  rowMain: { flexDirection: "row", justifyContent: "space-between", gap: spacing.md },
  name: { fontSize: 16, fontWeight: "500", flexShrink: 1 },
  amount: { fontSize: 16 },
  tags: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm },
});
