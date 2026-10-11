/** The shape every stored value has: a schema version and the plugin's own payload; other keys are kept, not dropped. */
export type EnvelopeRead<T = unknown> =
  | { ok: true; v: number; config: T; rest: Record<string, unknown> }
  | { ok: false; reason: string };

export const writeEnvelope = (v: number, config: unknown, rest: Record<string, unknown> = {}): string => JSON.stringify({ v, config, ...rest });

/** Reads `{ v, config }`. Never throws: a value that cannot be used comes back as `{ ok: false, reason }` and must not be overwritten. */
export function readEnvelope<T = unknown>(text: string, supported: number): EnvelopeRead<T> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, reason: "Not JSON" };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, reason: "Not a JSON object" };
  const { v, config, ...rest } = value as Record<string, unknown>;
  if (typeof v !== "number") return { ok: false, reason: "No version (v)" };
  if (v > supported) return { ok: false, reason: `Written by a newer version (v${v}, this one reads up to v${supported})` };
  if (config === undefined) return { ok: false, reason: "No config" };
  return { ok: true, v, config: config as T, rest };
}
