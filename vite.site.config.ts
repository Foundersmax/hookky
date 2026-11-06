// Builds the landing page (site/) for GitHub Pages: npm run build:site → dist-site/
import { defineConfig } from "vite";

export default defineConfig({
  root: "site",
  publicDir: "../public",
  base: "/",
  build: { outDir: "../dist-site", emptyOutDir: true },
});
