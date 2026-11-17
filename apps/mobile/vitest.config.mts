import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Tests de la logique pure de l'app (sans React Native) ; les écrans se vérifient dans l'app.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { include: ["src/**/*.test.ts"], environment: "node" },
});
