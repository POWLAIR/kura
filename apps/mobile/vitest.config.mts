import { defineConfig } from "vitest/config";

// Tests de la logique pure de l'app (sans React Native) ; les écrans se vérifient dans l'app.
export default defineConfig({
  test: { include: ["src/**/*.test.ts"], environment: "node" },
});
