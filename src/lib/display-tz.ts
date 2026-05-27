import { isValidIanaTimeZone } from "@/lib/client-today";
import { getHandoffTz } from "@/lib/env";

/** Prefer client IANA zone when valid; otherwise server HANDOFF_TZ. */
export function resolveDisplayTimeZone(clientTimeZone: unknown): string {
  if (typeof clientTimeZone === "string" && isValidIanaTimeZone(clientTimeZone)) {
    return clientTimeZone.trim();
  }
  return getHandoffTz();
}
