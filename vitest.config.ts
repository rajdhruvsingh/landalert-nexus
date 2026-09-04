/**
 * Vitest configuration — separate from vite.config.ts to avoid
 * loading the TanStack Start plugin, which requires a running Vite
 * dev server context and crashes in the Vitest environment.
 *
 * Only unit tests for plain TypeScript modules (e.g. src/lib/risk.ts)
 * are in scope here.  Tests that require a DOM or React rendering
 * should use the 'jsdom' environment below.
 */
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: ["node_modules", "dist"],
    reporters: ["verbose"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
