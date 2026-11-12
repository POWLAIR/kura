import {
  AddItemsInput,
  DeleteEntryInput,
  FoodConversionInput,
  InventoryQuery,
  LogMealInput,
  LogWeightInput,
  LogWorkoutInput,
  RemoveItemInput,
  SummaryInput,
  UpdateItemInput,
  UpdateWeightInput,
  UpdateWorkoutInput,
} from "@kura/core";
import { z } from "zod";
import type { Tx } from "./db.ts";
import {
  addPurchases,
  getInventory,
  getShoppingList,
  removeItem,
  updateItem,
} from "./inventory.ts";
import {
  deleteEntry,
  getSummary,
  logMeal,
  logWeight,
  logWorkout,
  setFoodConversion,
  updateWeight,
  updateWorkout,
} from "./tracking.ts";

// Les opérations métier de Kura : une seule liste, servie par les tools MCP (Claude) et par
// l'API de l'app. Chacune valide son entrée avec le schéma Zod de @kura/core et s'exécute
// dans la transaction de l'utilisateur (asUser), donc sous RLS.

function operation<S extends z.ZodType>(
  input: S,
  run: (tx: Tx, input: z.infer<S>) => Promise<unknown>,
) {
  return { input, run };
}

export const OPERATIONS = {
  get_inventory: operation(InventoryQuery, getInventory),
  add_items: operation(AddItemsInput, addPurchases),
  update_item: operation(UpdateItemInput, updateItem),
  remove_item: operation(RemoveItemInput, removeItem),
  get_shopping_list: operation(z.object({}), (tx) => getShoppingList(tx)),
  log_meal: operation(LogMealInput, logMeal),
  set_food_conversion: operation(FoodConversionInput, setFoodConversion),
  log_workout: operation(LogWorkoutInput, logWorkout),
  log_weight: operation(LogWeightInput, logWeight),
  delete_entry: operation(DeleteEntryInput, deleteEntry),
  update_workout: operation(UpdateWorkoutInput, updateWorkout),
  update_weight: operation(UpdateWeightInput, updateWeight),
  get_summary: operation(SummaryInput, getSummary),
};

export type OperationName = keyof typeof OPERATIONS;

export function isOperationName(name: string): name is OperationName {
  return Object.hasOwn(OPERATIONS, name);
}
