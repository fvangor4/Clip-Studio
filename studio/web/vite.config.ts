import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root,
  plugins: [react()],
  server: {
    proxy: { "/api": "http://localhost:3000" },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
