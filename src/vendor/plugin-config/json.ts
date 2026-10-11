/** A config value as a fenced, pretty-printed JSON block (a code block with highlighting in the host); throws on text that is not JSON. */
export function fenceJson(text: string): string {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("The config is not JSON, so it cannot be stored as a JSON block");
  }
  return "```json\n" + JSON.stringify(value, null, 2) + "\n```";
}

/**
 * What `fenceJson` wrote, back as compact text (what a store compares). Takes an unfenced value too (a hand edit, a `string`
 * property). Text that does not parse is returned as it is, for the caller's own validation to report.
 */
export function unfenceJson(text: string): string {
  const m = /^```[\w-]*\n([\s\S]*?)\n?```\s*$/.exec(text.trim());
  const body = m ? m[1]! : text;
  try {
    return JSON.stringify(JSON.parse(body));
  } catch {
    return body;
  }
}

/** A property value as text: the string of a `string` property, or the `value` (else `title`) of the block a text property holds. */
export function propertyText(raw: unknown): string | null {
  if (typeof raw === "string") return raw;
  if (raw && typeof raw === "object") {
    const o = raw as { value?: unknown; title?: unknown };
    if (typeof o.value === "string") return o.value;
    if (typeof o.title === "string") return o.title;
  }
  return null;
}
