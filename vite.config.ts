import { defineConfig, type Plugin } from "vite";

/**
 * N33: the built plugin page gets a Content-Security-Policy (its own scripts and styles only, no network). Inline
 * `style` attributes are needed (the views place bars with them). Build only: the dev server's client and HMR are left
 * alone. Checked live on the desktop app (lsp:// origin): no violation, every view works.
 */
export const CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'";
const csp = (): Plugin => ({
  name: "planner-csp",
  apply: "build",
  transformIndexHtml: (html) => html.replace("<title>", `<meta http-equiv="Content-Security-Policy" content="${CSP}">\n<title>`),
});

export default defineConfig({
  base: "./",
  publicDir: false,   // icon.svg lives at the repo root and travels in the release zip, not in dist/
  build: { outDir: "dist", emptyOutDir: true },
  plugins: [csp()],
  test: { include: ["src/**/*.test.ts", "scripts/**/*.test.mjs"], css: true },  // theme.test.ts reads theme.css?inline
});
