// @lovable.dev/vite-tanstack-config bundles the following plugins — do NOT add them manually
// or the build will fail with duplicate plugin errors:
//   - TanStack devtools (dev-only), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only; default target is cloudflare-workers — override via NITRO_PRESET env),
//     VITE_* env injection, @ path alias, React/TanStack dedupe, and error logger plugins.
// Additional config can be passed via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this entry point.
    server: { entry: "server" },
  },
});
