import js from "@eslint/js";
import globals from "globals";

export default [
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "coverage/**",
      ".vercel/**",
      "src/icons/**",
    ],
  },
  js.configs.recommended,

  // Browser app code (ES modules).
  {
    files: ["src/js/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.browser },
    },
    rules: {
      "no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },

  // Node-side config + tooling files (incl. build scripts).
  {
    files: [
      "*.config.js",
      "vite.config.js",
      "scripts/**/*.{js,mjs}",
      ".claude/hooks/**/*.mjs",
    ],
    languageOptions: {
      sourceType: "module",
      globals: { ...globals.node },
    },
  },

  // Unit tests (Vitest) and e2e drivers (Node + Playwright).
  {
    files: ["test/**/*.js", "**/*.test.js", "e2e/**/*.js"],
    languageOptions: {
      sourceType: "module",
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      "no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
];
