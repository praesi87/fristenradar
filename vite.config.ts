/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// BASE_PATH wird im GitHub-Pages-Workflow auf "/<repo-name>/" gesetzt.
// Lokal (npm run dev) läuft die App unter "/".
export default defineConfig({
  base: process.env.BASE_PATH || "/",
  plugins: [react()],
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 30000,
  },
});
