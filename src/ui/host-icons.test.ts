import { describe, expect, it, vi } from "vitest";
import { borrowHostIconFont, hostIconFontUrl, type HostStyles } from "./host-icons";

const face = (family: string, src: string) => ({ type: 5, cssText: `@font-face { font-family: ${family}; font-style: normal; src: ${src}; }` });
const sheets = (rules: unknown[], href: string | null = "lsp://logseq.com/css/style.css"): HostStyles => ({ baseURI: "lsp://logseq.com/index.html", styleSheets: [{ href, cssRules: rules as never[] }] });

describe("hostIconFontUrl (N55: the host's tabler icon font)", () => {
  it("finds the tabler-icons face, the woff2 source, resolved against its stylesheet", () => {
    const doc = sheets([face("Inter", 'url("./inter.woff2") format("woff2")'), face("tabler-icons", 'url("./fonts/tabler-icons.woff2?v2.47.0") format("woff2"), url("./fonts/tabler-icons.ttf") format("truetype")')]);
    expect(hostIconFontUrl(doc)).toBe("lsp://logseq.com/css/fonts/tabler-icons.woff2?v2.47.0");
  });

  it("takes the quoted family too, ignores the extension font, and is null without one", () => {
    expect(hostIconFontUrl(sheets([face('"tabler-icons"', 'url("a/t.woff2") format("woff2")')]))).toBe("lsp://logseq.com/css/a/t.woff2");
    expect(hostIconFontUrl(sheets([face("tabler-icons-extension", 'url("x.woff2") format("woff2")')]))).toBeNull();
    expect(hostIconFontUrl(sheets([]))).toBeNull();
  });

  it("only takes a font from the stylesheet's own origin (SEC-002): another host, a data: URL or a scheme-relative one is skipped", () => {
    const own = face("tabler-icons", 'url("./own.woff2") format("woff2")');
    expect(hostIconFontUrl(sheets([face("tabler-icons", 'url("https://evil.example/t.woff2") format("woff2")')]))).toBeNull();
    expect(hostIconFontUrl(sheets([face("tabler-icons", 'url("//evil.example/t.woff2") format("woff2")')]))).toBeNull();
    expect(hostIconFontUrl(sheets([face("tabler-icons", 'url("data:font/woff2;base64,AAAA") format("woff2")')]))).toBeNull();
    expect(hostIconFontUrl(sheets([face("tabler-icons", 'url("https://evil.example/t.woff2") format("woff2")'), own]))).toBe("lsp://logseq.com/css/own.woff2");
  });

  it("skips a stylesheet that cannot be read (cross-origin rules throw)", () => {
    const bad = { href: "https://cdn/x.css", get cssRules(): never { throw new Error("SecurityError"); } };
    const good = { href: "lsp://logseq.com/s.css", cssRules: [face("tabler-icons", 'url("t.woff2") format("woff2")')] as never[] };
    expect(hostIconFontUrl({ baseURI: "lsp://logseq.com/", styleSheets: [bad, good] })).toBe("lsp://logseq.com/t.woff2");
  });
});

describe("borrowHostIconFont", () => {
  const doc = sheets([face("tabler-icons", 'url("t.woff2") format("woff2")')]);

  it("fetches the host's font with the host's fetch and adds it to the frame's fonts for the private-use range", async () => {
    const buffer = new ArrayBuffer(8);
    const hostFetch = vi.fn(async () => ({ ok: true, arrayBuffer: async () => buffer }));
    const added: unknown[] = [];
    const Face = vi.fn(function (this: { load: () => Promise<unknown> }) { this.load = async () => this; });
    await borrowHostIconFont(doc, { fetch: hostFetch as never, FontFace: Face as never, fonts: { add: (f: unknown) => void added.push(f) } });
    expect(hostFetch).toHaveBeenCalledWith("lsp://logseq.com/css/t.woff2");
    expect(Face).toHaveBeenCalledWith("Planner Icons", buffer, { unicodeRange: "U+E000-F8FF", display: "swap" });
    expect(added).toHaveLength(1);
  });

  it("does nothing, and never throws, without a host font or when the fetch fails", async () => {
    const fonts = { add: vi.fn() };
    await borrowHostIconFont(sheets([]), { fetch: vi.fn() as never, FontFace: vi.fn() as never, fonts });
    await borrowHostIconFont(doc, { fetch: (async () => ({ ok: false })) as never, FontFace: vi.fn() as never, fonts });
    await borrowHostIconFont(doc, { fetch: (async () => { throw new Error("offline"); }) as never, FontFace: vi.fn() as never, fonts });
    expect(fonts.add).not.toHaveBeenCalled();
  });
});
