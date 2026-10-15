import { defineConfig } from "eslint/config";
import globals from "globals";
import nextTs from "eslint-config-next/typescript";
export default defineConfig([
  { ignores: ["node_modules/**", "dist/**", "public/ocr/**", ".wrangler/**", ".sites-runtime/**"] },
  ...nextTs.map((config) => ({ ...config, files: ["server/**/*.ts"] })),
  {
    files: ["server/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["error", { args: "none" }],
    },
  },
  {
    files: ["public/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.browser, ...globals.serviceworker },
    },
    rules: {
      "no-undef": "error",
      "no-unreachable": "error",
      "no-duplicate-imports": "error",
      "no-unused-vars": ["error", { args: "none", caughtErrors: "none" }],
    },
  },
]);
