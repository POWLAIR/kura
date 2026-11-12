import { localDate } from "@kura/core";

// La journée en cours à Paris (AAAA-MM-JJ), comme pour get_summary.
export function today(): string {
  return localDate(new Date());
}
