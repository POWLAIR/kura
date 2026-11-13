import { z } from "zod";

// Droits sur ses données (conception, « Sécurité et données de santé ») : tout récupérer,
// tout supprimer.

// Mot à taper pour confirmer la suppression du compte : elle ne se rattrape pas.
export const DELETE_ACCOUNT_WORD = "SUPPRIMER";

export const DeleteAccountInput = z.object({
  confirm: z.literal(DELETE_ACCOUNT_WORD),
});
export type DeleteAccountInput = z.infer<typeof DeleteAccountInput>;

// Export complet : une liste de lignes par table, telles qu'elles sont en base.
export type DataExport = {
  format: 1;
  exported_at: string;
  tables: Record<string, Record<string, unknown>[]>;
};
