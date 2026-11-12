import {
  type AddItemsInput,
  type AmbiguityReason,
  createFoodMatcher,
  type Food,
  type InventoryLine,
  type InventoryQuery,
  type PurchaseItem,
  type PurchasePlan,
  planPurchase,
  type Tables,
  toStockChanges,
  type UpdateItemInput,
} from "@kura/core";
import type postgres from "postgres";
import type { z } from "zod";
import type { Tx } from "./db.ts";
import { compact, InputError } from "./errors.ts";

// Opérations d'inventaire, partagées par les tools MCP et l'API de l'app (issues #6, #42).
// Décisions dans @kura/core (planPurchase), écritures par les fonctions SQL add_item,
// restock_item et update_item, dans la transaction de l'utilisateur (RLS).

type Status = Tables<"inventory_status">;

const AMBIGUITY_HINTS: Record<AmbiguityReason, string> = {
  food: "Aliment de référence à choisir : relancer avec food_ref_id parmi candidates, ou food_ref_id null si aucun ne correspond. Si c'est un article déjà en stock (items), relancer avec item_id.",
  several_items: "Plusieurs articles correspondent : relancer avec item_id, ou préciser location.",
  quantity_required: "Article suivi en quantité : préciser quantity et unit.",
  unit_mismatch:
    "Article suivi dans une autre unité : donner la quantité dans cette unité, ou corriger l'article avec update_item.",
  unknown_item: "item_id inconnu : voir get_inventory.",
  unknown_food: "food_ref_id inconnu : reprendre un id parmi les candidats proposés.",
};

// Vue compacte d'un article : les champs vides sont omis.
function itemView(row: Status) {
  const view = {
    id: row.id,
    name: row.name,
    category: row.category,
    location: row.location,
    quantity: row.quantity,
    unit: row.unit,
    level: row.level,
    expires_on: row.expires_on,
    restock_threshold: row.restock_threshold,
    restock_level: row.restock_level,
    low_stock: row.low_stock || undefined,
    food: row.food_ref_id ? { id: row.food_ref_id, name: row.food_name } : undefined,
  };
  return compact(view);
}

function lineView(line: InventoryLine) {
  const amount = line.level ?? `${line.quantity} ${line.unit}`;
  return { item_id: line.id, name: line.name, location: line.location, amount };
}

function ambiguousView(input: PurchaseItem, plan: Extract<PurchasePlan, { action: "ambiguous" }>) {
  return {
    name: input.name,
    reason: plan.reason,
    hint: AMBIGUITY_HINTS[plan.reason],
    candidates: plan.candidates.map((f: Food) => ({ food_ref_id: f.id, name: f.name })),
    items: plan.items.map(lineView),
  };
}

function selectInventory(tx: Tx, query: InventoryQuery) {
  return tx<Status[]>`
    select * from public.inventory_status
    where true
      ${query.category ? tx`and category = ${query.category}` : tx``}
      ${query.location ? tx`and location = ${query.location}` : tx``}
      ${query.low_stock_only ? tx`and low_stock` : tx``}
    order by location, category, name`;
}

async function addItems(tx: Tx, items: PurchaseItem[]) {
  const inventory = await tx<InventoryLine[]>`
    select id, name, location, food_ref_id, quantity, unit, level from public.inventory_item`;
  const foods = await tx<Food[]>`select id, code, name from public.food_ref`;
  const ctx = {
    inventory,
    foodsById: new Map(foods.map((f) => [f.id, f])),
    matchFood: createFoodMatcher(foods, { maxCandidates: 5 }),
  };

  const created: number[] = [];
  const restocked: number[] = [];
  const ambiguous: ReturnType<typeof ambiguousView>[] = [];
  for (const input of items) {
    const plan = planPurchase(input, ctx);
    if (plan.action === "ambiguous") {
      ambiguous.push(ambiguousView(input, plan));
    } else if (plan.action === "restock") {
      await tx`select public.restock_item(
        ${plan.item.id}::bigint, ${plan.amount?.quantity ?? null}::numeric,
        ${plan.amount?.unit ?? null}::public.quantity_unit, ${plan.expiresOn}::date)`;
      restocked.push(plan.item.id);
    } else {
      const [row] = await tx<{ id: number }[]>`select public.add_item(
        ${plan.name}::text, ${plan.category}::public.inventory_category,
        ${plan.location}::public.inventory_location, ${plan.amount?.quantity ?? null}::numeric,
        ${plan.amount?.unit ?? null}::public.quantity_unit, ${plan.food?.id ?? null}::bigint,
        ${plan.expiresOn}::date) as id`;
      if (!row) throw new Error("add_item sans id");
      created.push(row.id);
      // Un même article répété dans la liste réapprovisionne celui qu'on vient de créer.
      ctx.inventory.push({
        id: row.id,
        name: plan.name,
        location: plan.location,
        food_ref_id: plan.food?.id ?? null,
        quantity: plan.amount?.quantity ?? null,
        unit: plan.amount?.unit ?? null,
        level: plan.amount ? null : "plein",
      });
    }
  }

  const touched = [...created, ...restocked];
  const rows = touched.length
    ? await tx<Status[]>`select * from public.inventory_status where id in ${tx(touched)}`
    : [];
  const view = (ids: number[]) =>
    ids.flatMap((id) => rows.filter((r) => r.id === id).map(itemView));
  // Un article créé puis réapprovisionné dans la même liste n'apparaît que dans created.
  const onlyRestocked = [...new Set(restocked)].filter((id) => !created.includes(id));
  return { created: view(created), restocked: view(onlyRestocked), ambiguous };
}

// Rejoué avec la même clé d'idempotence, l'appel renvoie la réponse enregistrée sans rien
// réécrire. La clé est réservée dans la transaction de l'appel : en cas d'échec, elle est
// libérée avec le reste ; deux appels simultanés se sérialisent sur la contrainte unique.
export async function addPurchases(tx: Tx, { items, idempotency_key: key }: AddItemsInput) {
  if (!key) return addItems(tx, items);
  const [claim] = await tx<{ id: number }[]>`
    insert into public.idempotent_call (idempotency_key, tool) values (${key}, 'add_items')
    on conflict (user_id, idempotency_key) do nothing
    returning id`;
  if (!claim) {
    const [previous] = await tx<{ tool: string; response: Record<string, unknown> }[]>`
      select tool, response from public.idempotent_call where idempotency_key = ${key}`;
    if (previous?.tool !== "add_items") {
      throw new InputError(
        `Clé d'idempotence déjà utilisée par ${previous?.tool ?? "un autre appel"}`,
      );
    }
    return { replayed: true, ...previous.response };
  }
  const result = await addItems(tx, items);
  // Rien d'enregistré (tout est ambigu) : la clé est libérée, pour que la relance avec les
  // précisions demandées ne reçoive pas l'ancienne réponse.
  if (result.created.length === 0 && result.restocked.length === 0) {
    await tx`delete from public.idempotent_call where id = ${claim.id}`;
    return result;
  }
  await tx`update public.idempotent_call
           set response = ${tx.json(result as unknown as postgres.JSONValue)}
           where id = ${claim.id}`;
  return result;
}

// Libellé du suivi d'un article : son unité, ou « niveau ».
const tracking = (unit: string | null) => unit ?? "niveau";

export async function getInventory(tx: Tx, query: InventoryQuery) {
  return { items: (await selectInventory(tx, query)).map(itemView) };
}

// Liste « À racheter » : articles au seuil de rachat ou en dessous.
export function getShoppingList(tx: Tx) {
  return getInventory(tx, { low_stock_only: true });
}

export async function updateItem(tx: Tx, { item_id, changes }: z.infer<typeof UpdateItemInput>) {
  const [before] = await tx<{ unit: string | null }[]>`
    select unit from public.inventory_item where id = ${item_id}`;
  await tx`select public.update_item(${item_id}::bigint, ${tx.json(toStockChanges(changes))}::jsonb)`;
  const [after] = await tx<Status[]>`
    select * from public.inventory_status where id = ${item_id}`;
  if (!before || !after) throw new InputError(`Article ${item_id} introuvable`);
  // Changement d'unité ou de mode : le dire, l'ancien suivi est perdu.
  const [from, to] = [tracking(before.unit), tracking(after.unit)];
  const notice =
    from === to
      ? undefined
      : `Suivi changé de « ${from} » à « ${to} » : ancien seuil de rachat effacé, aucun mouvement de stock enregistré.`;
  return { updated: itemView(after), ...(notice && { notice }) };
}
