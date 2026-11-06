import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": { target: "http://localhost:8787", changeOrigin: true } },
  },
  // The claude.ai build is one self-contained page: inline lazily loaded modules (the MP4 decoder).
  ...(mode === "artifact" && { build: { rolldownOptions: { output: { inlineDynamicImports: true } } } }),
}));
