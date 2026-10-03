// Display titles: a block title stores an inline ref as `[[<uuid>]]`; views show the referenced node's title instead.
// Pure: no DOM, no SDK. Every view renders titles through `displayTitle`.

/** Shown for a ref to a node that is not loaded: never the raw uuid. */
export const LINK_PLACEHOLDER = "(link)";

const REF = /\[\[([^\[\]]+)\]\]/g;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Lookup of titles by (lower-case) uuid, built once per load from the loaded nodes. */
export const titlesByUuid = (nodes: { uuid: string; title: string }[]): ReadonlyMap<string, string> =>
  new Map(nodes.map((n) => [n.uuid.toLowerCase(), n.title]));

/** `title` with every `[[uuid]]` replaced by that node's title (placeholder when unknown) and other `[[text]]` unbracketed. */
export const displayTitle = (title: string, titles: ReadonlyMap<string, string>): string =>
  title.replace(REF, (_, inner: string) => (UUID.test(inner) ? titles.get(inner.toLowerCase()) ?? LINK_PLACEHOLDER : inner));
