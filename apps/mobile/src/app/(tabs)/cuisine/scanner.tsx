import { type AddItemsResult, Ean, formatAmount, LEVEL_LABELS, LOCATION_LABELS } from "@kura/core";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useRouter } from "expo-router";
import { useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Button, Choice, Field, Notice, SectionTitle } from "@/components/ui";
import { ambiguityMessage, hasNoMatch, type PurchaseChoice } from "@/inventory/item-form";
import { CATEGORY_OPTIONS, LOCATION_OPTIONS, UNIT_OPTIONS } from "@/inventory/options";
import {
  acceptScan,
  lineFromProduct,
  locationOf,
  manualLine,
  mergeSummaries,
  purchasesOf,
  remainingLines,
  rescanned,
  type ScanLine,
  type ScannedFood,
  type ScanSummary,
  summaryOf,
} from "@/inventory/scan";
import { useInventory } from "@/inventory/use-inventory";
import { callApi, callOffProduct } from "@/lib/api";
import { errorMessage } from "@/lib/api-error";
import { newIdempotencyKey } from "@/lib/idempotency";
import { spacing, usePalette } from "@/theme";

type OffAnswer = { found: true; food: ScannedFood } | { found: false; ean: string };

const BARCODE_TYPES = ["ean13", "ean8", "upc_a", "upc_e"] as const;

function existingAmount(amount: string): string {
  return amount in LEVEL_LABELS ? LEVEL_LABELS[amount as keyof typeof LEVEL_LABELS] : amount;
}

const list = (names: string[]) => names.map((name) => `« ${name} »`).join(", ");

// Une ligne de la liste temporaire : ce qui va se passer, et ce qui reste à préciser.
function LineCard(props: {
  line: ScanLine;
  disabled: boolean;
  onChange: (changes: Partial<ScanLine>) => void;
  onRemove: () => void;
}) {
  const palette = usePalette();
  const { line, onChange } = props;
  const { existing, ambiguity } = line;
  const byLevel = existing !== null && existing.level !== null;
  const place = locationOf(line);
  const choose = (choice: PurchaseChoice) => onChange({ choice, ambiguity: null });

  return (
    <View
      accessibilityLabel={`Ligne ${line.name}`}
      style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}
    >
      <View style={styles.cardHead}>
        <Text style={[styles.name, { color: palette.text }]}>
          {line.name}
          {line.count > 1 ? ` × ${line.count}` : ""}
        </Text>
        <Button
          disabled={props.disabled}
          label="Retirer"
          onPress={props.onRemove}
          variant="quiet"
        />
      </View>
      <Text style={{ color: palette.textSecondary, lineHeight: 20 }}>
        {existing
          ? `Réapprovisionne « ${existing.name} » · ${LOCATION_LABELS[existing.location]}, ${formatAmount(existing)} en stock`
          : `Nouvel article${place ? ` · ${LOCATION_LABELS[place]}` : ""}${line.food?.brand ? ` · ${line.food.brand}` : ""}`}
      </Text>

      {existing === null ? (
        <>
          <Choice
            label="Catégorie"
            onChange={(category) => onChange({ category })}
            options={CATEGORY_OPTIONS}
            value={line.category}
          />
          <Choice
            label="Emplacement (sinon selon la catégorie)"
            onChange={(location) =>
              onChange({ location: location === line.location ? null : location })
            }
            options={LOCATION_OPTIONS}
            value={line.location}
          />
        </>
      ) : null}

      {byLevel ? (
        <Text style={{ color: palette.textSecondary }}>
          Suivi en niveau : il repasse à « Plein ».
        </Text>
      ) : (
        <>
          <Field
            hint={
              existing ? undefined : "Laisse vide pour un suivi en niveau (pot, bouteille, épice)."
            }
            inputMode="decimal"
            label={`Quantité achetée, ${line.name}`}
            onChangeText={(quantity) => onChange({ quantity })}
            value={line.quantity}
          />
          {line.quantity.trim() !== "" && existing === null ? (
            <Choice
              label="Unité"
              onChange={(unit) => onChange({ unit })}
              options={UNIT_OPTIONS}
              value={line.unit}
            />
          ) : null}
          {existing ? (
            <Text style={{ color: palette.textSecondary }}>
              En {existing.unit === "piece" ? "pièces" : existing.unit}, comme l'article en stock.
            </Text>
          ) : null}
        </>
      )}

      {ambiguity ? (
        <View style={styles.choices}>
          <Notice problem>{ambiguityMessage(ambiguity)}</Notice>
          {ambiguity.items.map((item) => (
            <Button
              key={item.item_id}
              label={`${item.name} · ${LOCATION_LABELS[item.location]}, ${existingAmount(item.amount)}`}
              onPress={() => choose({ item_id: item.item_id })}
              variant="secondary"
            />
          ))}
          {ambiguity.candidates.map((candidate) => (
            <Button
              key={candidate.food_ref_id}
              label={candidate.name}
              onPress={() => choose({ food_ref_id: candidate.food_ref_id })}
              variant="secondary"
            />
          ))}
          {ambiguity.reason === "food" ? (
            <Button
              label={hasNoMatch(ambiguity) ? "Ajouter quand même" : "Aucun ne correspond"}
              onPress={() => choose({ food_ref_id: null })}
              variant="secondary"
            />
          ) : null}
        </View>
      ) : null}
      {line.choice ? (
        <Text style={{ color: palette.textSecondary }}>
          Précision notée : relance « Tout ranger ».
        </Text>
      ) : null}
    </View>
  );
}

// Parcours « ranger les courses » : la caméra lit les codes-barres en continu, chaque
// produit reconnu rejoint une liste temporaire, et « Tout ranger » enregistre la liste en
// une fois avec add_items (une transaction, rejouable sans doublon).
export default function ScannerScreen() {
  const palette = usePalette();
  const router = useRouter();
  const inventory = useInventory();
  const [permission, requestPermission] = useCameraPermissions();
  const [lines, setLines] = useState<ScanLine[]>([]);
  const [looking, setLooking] = useState(0); // produits en cours de recherche
  const [message, setMessage] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [key, setKey] = useState(() => newIdempotencyKey("scan"));
  const [summary, setSummary] = useState<ScanSummary | null>(null);
  const seen = useRef(new Map<string, number>());
  const manualCount = useRef(0);
  // Codes déjà dans la liste, ou en cours de recherche.
  const keys = useRef(new Set<string>());

  const change = (lineKey: string, changes: Partial<ScanLine>) =>
    setLines((previous) =>
      previous.map((line) => (line.key === lineKey ? { ...line, ...changes } : line)),
    );

  // Un code lu par la caméra (silencieux s'il est illisible) ou tapé (message sinon).
  async function addCode(raw: string, typed: boolean) {
    const parsed = Ean.safeParse(raw);
    if (!parsed.success) {
      if (typed) setMessage("Ce n'est pas un code-barres : 8, 12 ou 13 chiffres sont attendus.");
      return;
    }
    const ean = parsed.data;
    // Un code tapé est voulu ; un code lu par la caméra revient plusieurs fois par seconde.
    if (!typed && !acceptScan(ean, Date.now(), seen.current)) return;
    setMessage(null);

    // Déjà dans la liste : un emballage de plus.
    if (keys.current.has(ean)) {
      setLines((previous) => previous.map((line) => (line.key === ean ? rescanned(line) : line)));
      return;
    }
    keys.current.add(ean);

    setLooking((count) => count + 1);
    try {
      const answer = await callOffProduct<OffAnswer>(ean);
      if (answer.found) {
        const line = lineFromProduct(answer.food, inventory.items);
        setLines((previous) => [line, ...previous]);
      } else {
        keys.current.delete(ean);
        setMessage(
          `Le code ${ean} est inconnu d'Open Food Facts. Ajoute ce produit par son nom, juste en dessous.`,
        );
      }
    } catch (error) {
      // Ce code pourra être relu tout de suite.
      seen.current.delete(ean);
      keys.current.delete(ean);
      setMessage(errorMessage(error));
    } finally {
      setLooking((count) => count - 1);
    }
  }

  function addByName() {
    if (name.trim() === "") return;
    manualCount.current += 1;
    setLines((previous) => [manualLine(name, `sans-code-${manualCount.current}`), ...previous]);
    setName("");
    setMessage(null);
  }

  async function storeAll() {
    const purchases = purchasesOf(lines);
    if (!purchases.ok) {
      setMessage(purchases.message);
      return;
    }
    setPending(true);
    setMessage(null);
    try {
      const result = await callApi<AddItemsResult>("add_items", {
        items: purchases.value,
        idempotency_key: key,
      });
      // Une clé par envoi : ce qui reste ambigu repartira avec une nouvelle clé.
      setKey(newIdempotencyKey("scan"));
      setSummary((previous) => mergeSummaries(previous, summaryOf(result, inventory.items)));
      const remaining = remainingLines(lines, result);
      keys.current = new Set(remaining.map((line) => line.key));
      setLines(remaining);
      await inventory.reload();
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setPending(false);
    }
  }

  const done = summary !== null && lines.length === 0;
  const stored = summary ? summary.created.length + summary.restocked.length : 0;

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      style={{ backgroundColor: palette.background }}
    >
      <View style={styles.column}>
        {summary && stored > 0 ? (
          <Notice>
            {[
              summary.restocked.length > 0 ? `Réapprovisionné : ${list(summary.restocked)}.` : null,
              summary.created.length > 0 ? `Ajouté : ${list(summary.created)}.` : null,
              summary.noLongerToRestock.length > 0
                ? `Plus à racheter : ${list(summary.noLongerToRestock)}.`
                : null,
            ]
              .filter(Boolean)
              .join(" ")}
          </Notice>
        ) : null}

        {done ? (
          <Button label="Retour à l'inventaire" onPress={() => router.back()} />
        ) : (
          <>
            {permission?.granted ? (
              <CameraView
                barcodeScannerSettings={{ barcodeTypes: [...BARCODE_TYPES] }}
                facing="back"
                onBarcodeScanned={pending ? undefined : ({ data }) => addCode(data, false)}
                style={styles.camera}
              />
            ) : (
              <>
                <Text style={{ color: palette.textSecondary, lineHeight: 22 }}>
                  L'appareil photo lit les codes-barres en continu : passe les produits devant
                  l'objectif, ils s'ajoutent à la liste.
                </Text>
                <Button
                  label="Autoriser l'appareil photo"
                  onPress={requestPermission}
                  variant="secondary"
                />
              </>
            )}

            <View style={styles.inline}>
              <View style={styles.grow}>
                <Field
                  inputMode="numeric"
                  label="Code-barres"
                  onChangeText={setCode}
                  onSubmitEditing={() => {
                    addCode(code, true);
                    setCode("");
                  }}
                  placeholder="Si le scan ne passe pas"
                  value={code}
                />
              </View>
              <Button
                label="Chercher"
                onPress={() => {
                  addCode(code, true);
                  setCode("");
                }}
                variant="secondary"
              />
            </View>
            <View style={styles.inline}>
              <View style={styles.grow}>
                <Field
                  label="Sans code-barres"
                  onChangeText={setName}
                  onSubmitEditing={addByName}
                  placeholder="Pommes, carottes…"
                  value={name}
                />
              </View>
              <Button label="Ajouter à la liste" onPress={addByName} variant="secondary" />
            </View>

            {looking > 0 ? (
              <Text style={{ color: palette.textSecondary }}>Recherche du produit…</Text>
            ) : null}
            {message ? <Notice problem>{message}</Notice> : null}

            <SectionTitle>{`À ranger (${lines.length})`}</SectionTitle>
            {lines.length === 0 ? (
              <Text style={{ color: palette.textSecondary }}>
                Rien pour l'instant. Rien n'est enregistré avant « Tout ranger ».
              </Text>
            ) : null}
            {lines.map((line) => (
              <LineCard
                disabled={pending}
                key={line.key}
                line={line}
                onChange={(changes) => change(line.key, changes)}
                onRemove={() => {
                  keys.current.delete(line.key);
                  setLines((previous) => previous.filter((other) => other.key !== line.key));
                }}
              />
            ))}

            <Button
              busy={pending}
              disabled={lines.length === 0}
              label={`Tout ranger (${lines.length})`}
              onPress={storeAll}
            />
          </>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, alignItems: "center" },
  column: { width: "100%", maxWidth: 720, gap: spacing.md },
  camera: { height: 220, borderRadius: 12, overflow: "hidden" },
  inline: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm },
  grow: { flex: 1 },
  card: { borderWidth: 1, borderRadius: 12, padding: spacing.md, gap: spacing.sm },
  cardHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  name: { fontSize: 17, fontWeight: "600", flexShrink: 1 },
  choices: { gap: spacing.sm },
});
