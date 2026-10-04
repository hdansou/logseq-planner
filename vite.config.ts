import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  publicDir: false,   // icon.svg lives at the repo root and travels in the release zip, not in dist/
  build: { outDir: "dist", emptyOutDir: true },
  test: { include: ["src/**/*.test.ts", "scripts/**/*.test.mjs"], css: true },  // theme.test.ts reads theme.css?inline
});
