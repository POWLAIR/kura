// Import ponctuel de l'inventaire depuis la page Notion (issue #3).
//
//   pnpm import:notion <lien ou id de la page> [--dry-run] [--user <email>] [--choices <fichier.json>]
//
// Lit la page avec l'API Notion (NOTION_TOKEN), déduit catégorie, emplacement et
// quantité de chaque puce, rapproche les noms de Ciqual, puis crée les
// inventory_item et un stock_movement « achat » par article. Règles : docs/notion.md.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { type Database, STOCK_LEVEL_FRACTION } from "@kura/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { type Food, type FoodChoices, type FoodMatch, matchFoods } from "./food-match";
import {
  type InventoryDraft,
  type NotionBlock,
  NotionBlockList,
  notionPageId,
  parseInventoryBlocks,
} from "./notion";
import { createAdminClient, loadEnv, requireEnv } from "./supabase";

const NOTION_VERSION = "2025-09-03";
const PAGE_SIZE = 1000; // max_rows de l'API Supabase

type Admin = SupabaseClient<Database>;

const FoodChoicesFile = z.record(z.string(), z.string().regex(/^\d+$/).nullable());

const UNIT_LABEL = { g: "g", ml: "ml", piece: "pièce(s)" } as const;
const LEVEL_LABEL = { plein: "plein", moitie: "moitié", presque_vide: "presque vide" } as const;

async function fetchBlocks(pageId: string, token: string): Promise<NotionBlock[]> {
  const blocks: NotionBlock[] = [];
  let cursor: string | null = null;
  do {
    const url = new URL(`https://api.notion.com/v1/blocks/${pageId}/children`);
    url.searchParams.set("page_size", "100");
    if (cursor) url.searchParams.set("start_cursor", cursor);
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, "Notion-Version": NOTION_VERSION },
    });
    if (res.status === 401) throw new Error("NOTION_TOKEN refusé par Notion");
    if (res.status === 403 || res.status === 404) {
      throw new Error("Page introuvable : la partager avec l'intégration Notion (⋯ → Connexions)");
    }
    if (!res.ok) throw new Error(`API Notion : HTTP ${res.status}`);
    const page = NotionBlockList.parse(await res.json());
    blocks.push(...page.results);
    cursor = page.has_more ? page.next_cursor : null;
  } while (cursor);
  return blocks;
}

async function loadCiqual(supabase: Admin): Promise<Food[]> {
  const foods: Food[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("food_ref")
      .select("id, code, name")
      .eq("source", "ciqual")
      .order("id")
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`Lecture de food_ref : ${error.message}`);
    foods.push(...data);
    if (data.length < PAGE_SIZE) break;
  }
  if (foods.length === 0) throw new Error("food_ref est vide : lancer d'abord pnpm import:ciqual");
  return foods;
}

async function findUserId(supabase: Admin, email: string): Promise<string> {
  // Usage solo : une seule page d'utilisateurs suffit.
  const { data, error } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw new Error(`Lecture des utilisateurs : ${error.message}`);
  const user = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (!user) throw new Error(`Aucun utilisateur ${email} dans Supabase Auth`);
  return user.id;
}

async function assertEmptyInventory(supabase: Admin, userId: string): Promise<void> {
  const { count, error } = await supabase
    .from("inventory_item")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  if (error) throw new Error(`Lecture de l'inventaire : ${error.message}`);
  if (count) {
    throw new Error(
      `L'inventaire contient déjà ${count} articles : import annulé (pas de doublons)`,
    );
  }
}

// Article en quantité : delta = quantité. En niveau : fraction d'un contenant plein.
function purchaseDelta(item: InventoryDraft): number {
  return item.level === null ? item.quantity : STOCK_LEVEL_FRACTION[item.level];
}

async function writeInventory(
  supabase: Admin,
  userId: string,
  items: InventoryDraft[],
  matches: Map<string, FoodMatch>,
): Promise<void> {
  const created: number[] = [];
  try {
    for (const item of items) {
      const match = matches.get(item.name);
      const { data, error } = await supabase
        .from("inventory_item")
        .insert({
          user_id: userId,
          name: item.name,
          food_ref_id: match?.status === "matched" ? match.food.id : null,
          category: item.category,
          location: item.location,
          quantity: item.quantity,
          unit: item.unit,
          level: item.level,
        })
        .select("id")
        .single();
      if (error) throw new Error(`Article « ${item.name} » : ${error.message}`);
      created.push(data.id);

      const { error: movementError } = await supabase.from("stock_movement").insert({
        user_id: userId,
        inventory_item_id: data.id,
        delta: purchaseDelta(item),
        reason: "achat",
      });
      if (movementError)
        throw new Error(`Mouvement de « ${item.name} » : ${movementError.message}`);
    }
  } catch (error) {
    // Pas de transaction côté client : on retire les articles créés (cascade sur stock_movement).
    if (created.length > 0) await supabase.from("inventory_item").delete().in("id", created);
    throw error;
  }
}

function amountLabel(item: InventoryDraft): string {
  if (item.level === null) return `${item.quantity} ${UNIT_LABEL[item.unit]}`;
  return `${LEVEL_LABEL[item.level]}${item.assumedLevel ? "*" : ""}`;
}

function report(items: InventoryDraft[], matches: Map<string, FoodMatch>, skipped: string[]) {
  const width = Math.max(...items.map((i) => i.name.length));
  let section = "";
  for (const item of items) {
    if (item.section !== section) {
      section = item.section;
      console.log(`\n${section} → catégorie ${item.category}`);
    }
    const match = matches.get(item.name);
    const ciqual =
      match?.status === "matched"
        ? `${match.food.code} ${match.food.name}${match.by === "choix" ? " (choix)" : ""}`
        : "—";
    console.log(
      `  ${item.name.padEnd(width)}  ${item.location.padEnd(11)}  ${amountLabel(item).padEnd(12)}  ${ciqual}`,
    );
  }
  console.log("\n* aucune quantité dans Notion : niveau « plein » supposé");

  const unmatched = items.filter((i) => matches.get(i.name)?.status !== "matched");
  if (unmatched.length > 0) {
    console.log(
      `\nSans correspondance Ciqual (${unmatched.length}), importés avec food_ref_id = null :`,
    );
    for (const item of unmatched) {
      const match = matches.get(item.name);
      const detail =
        match?.status !== "unmatched"
          ? "écarté (choix)"
          : match.candidates.length > 0
            ? `candidats : ${match.candidates.map((f) => `${f.code} ${f.name}`).join(" · ")}`
            : "aucun candidat";
      console.log(`  ${item.name} — ${detail}`);
    }
  }
  if (skipped.length > 0) console.log(`\nIgnorés (liste « À racheter ») : ${skipped.join(", ")}`);
}

function readChoices(path: string): FoodChoices {
  // pnpm lance le script depuis scripts/ : on résout le chemin depuis le dossier d'appel.
  const file = resolve(process.env.INIT_CWD ?? process.cwd(), path);
  return FoodChoicesFile.parse(JSON.parse(readFileSync(file, "utf8")));
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      "dry-run": { type: "boolean", default: false },
      user: { type: "string" },
      choices: { type: "string" },
    },
  });
  const page = positionals[0];
  if (!page || positionals.length > 1 || (!values["dry-run"] && !values.user)) {
    console.error(
      "Usage : pnpm import:notion <lien de la page> (--dry-run | --user <email>) [--choices <fichier.json>]",
    );
    process.exit(1);
  }

  loadEnv();
  const supabase = createAdminClient();
  const blocks = await fetchBlocks(notionPageId(page), requireEnv("NOTION_TOKEN"));
  const { items, skipped } = parseInventoryBlocks(blocks);
  if (items.length === 0) throw new Error("Aucun article trouvé dans la page");

  const choices = values.choices ? readChoices(values.choices) : {};
  const matches = matchFoods(
    items.map((i) => i.name),
    await loadCiqual(supabase),
    choices,
  );
  report(items, matches, skipped);
  const linked = items.filter((i) => matches.get(i.name)?.status === "matched").length;
  console.log(`\n${items.length} articles, dont ${linked} liés à Ciqual.`);

  const userId = values.user ? await findUserId(supabase, values.user) : null;
  if (userId) await assertEmptyInventory(supabase, userId);
  if (values["dry-run"] || !userId) {
    console.log("--dry-run : rien n'est écrit.");
    return;
  }

  await writeInventory(supabase, userId, items, matches);
  console.log(`Import terminé : ${items.length} articles, un mouvement « achat » chacun.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
