export type PropertyType = "string" | "default";

/**
 * The schema to apply before a config write: create a missing property hidden, only hide an existing one (a type cannot change
 * once a property holds data), nothing when it is already hidden. `default` is the host's text type: its value is a block, so it
 * can show as a code block; `string` is an internal type and stayed visible with `hide: true`. The key is `hide` (`hide?` is ignored).
 */
export function propertySchemaFor(existing: { type?: string; hide?: boolean } | null, type: PropertyType): { type?: PropertyType; hide: true } | null {
  if (!existing) return { type, hide: true };
  return existing.hide ? null : { hide: true };
}
