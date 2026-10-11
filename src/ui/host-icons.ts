/**
 * N55: the host's icon font in the frame. Choice values and titles can be tabler-icons characters (private-use code points);
 * the host draws them with its own `tabler-icons` @font-face, the frame has none, so they showed as boxes. Plugins follow the
 * host's style (fonts included), so the frame borrows the host's font file instead of bundling a copy: the host document is
 * reachable on the desktop app (`hostDocument()`), its fetch reads the font, and the frame adds it from the bytes (a font
 * built from a buffer is not subject to the frame's font-src policy).
 */

interface RuleLike {
  type?: number;
  cssText?: string;
}
interface SheetLike {
  href: string | null;
  cssRules: Iterable<RuleLike>;
}
/** The parts of a document the lookup reads. */
export interface HostStyles {
  baseURI: string;
  styleSheets: Iterable<SheetLike>;
}

const FONT_FACE_RULE = 5;
const FAMILY = /font-family:\s*["']?tabler-icons["']?\s*[;}]/;
const WOFF2_SRC = /url\(\s*["']?([^"')]+)["']?\s*\)\s*format\(\s*["']woff2["']\s*\)/;

/** The absolute URL of the host's `tabler-icons` woff2 file, or null when no readable stylesheet declares it from its own origin. */
export function hostIconFontUrl(doc: HostStyles): string | null {
  for (const sheet of doc.styleSheets) {
    let rules: RuleLike[];
    try {
      rules = [...sheet.cssRules]; // a cross-origin stylesheet throws here
    } catch {
      continue;
    }
    for (const rule of rules) {
      if (rule.type !== FONT_FACE_RULE || !rule.cssText || !FAMILY.test(rule.cssText)) continue;
      const src = WOFF2_SRC.exec(rule.cssText)?.[1];
      if (!src) continue;
      const base = new URL(sheet.href ?? doc.baseURI);
      const url = new URL(src, base);
      // Only the host's own origin: the fetch uses the host's privileges, so a font the CSS points elsewhere is not followed (SEC-002).
      if (`${url.protocol}//${url.host}` === `${base.protocol}//${base.host}`) return url.href;
    }
  }
  return null;
}

/** What `borrowHostIconFont` needs: the host's fetch, the frame's FontFace and font set. */
export interface FontTarget {
  fetch: (url: string) => Promise<{ ok: boolean; arrayBuffer(): Promise<ArrayBuffer> }>;
  FontFace: new (family: string, source: ArrayBuffer, descriptors: { unicodeRange: string; display: string }) => { load(): Promise<unknown> };
  fonts: { add(face: unknown): void };
}

/** Adds the host's icon font to the frame as "Planner Icons" for the private-use range. Never throws: without it the boxes stay. */
export async function borrowHostIconFont(doc: HostStyles, target: FontTarget): Promise<void> {
  try {
    const url = hostIconFontUrl(doc);
    if (!url) return;
    const res = await target.fetch(url);
    if (!res.ok) return;
    const face = new target.FontFace("Planner Icons", await res.arrayBuffer(), { unicodeRange: "U+E000-F8FF", display: "swap" });
    await face.load();
    target.fonts.add(face);
  } catch {
    // no host font, or it could not be read: private-use characters keep the fallback glyph
  }
}
