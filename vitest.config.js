import { defineConfig } from "vitest/config";

// Standalone Vitest config so unit tests don't pull in the app's build-time
// Vite plugins (SVG-sprite inlining, preconnect injection).
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.{js,ts}"],
    globals: false,
  },
});
