import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // El mismo atajo que tsconfig.json: "@/..." = "src/..."
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
});
