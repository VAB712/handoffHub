/** Split a workspace mail / DL field into unique addresses. */
export function parseMailRecipients(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/[,;\n]+/)) {
    const address = extractAddress(part);
    if (!address || seen.has(address)) continue;
    seen.add(address);
    out.push(address);
  }
  return out;
}

export function normalizeMailTo(raw: string | null | undefined): { ok: true; value: string | null } | { ok: false; error: string } {
  if (raw == null) return { ok: true, value: null };
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true, value: null };
  const parts = trimmed.split(/[,;\n]+/).map((p) => p.trim()).filter(Boolean);
  const addresses: string[] = [];
  for (const part of parts) {
    const address = extractAddress(part);
    if (!address) {
      return { ok: false, error: `Invalid email or DL: ${part}` };
    }
    addresses.push(address);
  }
  return { ok: true, value: [...new Set(addresses)].join(", ") };
}

function extractAddress(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const angled = trimmed.match(/<([^>]+)>/);
  const candidate = (angled?.[1] ?? trimmed).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate)) return null;
  return candidate;
}
