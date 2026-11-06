import { defineConfig, loadEnv } from "vite";
import { resolve } from "path";
import { readFileSync } from "fs";

// Inline the shared SVG icon sprite into every HTML entry point at build time.
// This replaces the render-blocking Google Material Symbols font: the sprite is
// authored once in src/icons/icons.svg, ships with zero extra network requests,
// and—being in-document—lets every <use> icon inherit color via currentColor.
const inlineSvgSprite = () => {
  const sprite = readFileSync(
    resolve(import.meta.dirname, "src/icons/icons.svg"),
    "utf8",
  ).trim();
  return {
    name: "inline-svg-sprite",
    transformIndexHtml(html) {
      // Inject right after the opening <body> tag (handles `<body id="...">` too).
      return html.replace(/<body[^>]*>/, (m) => `${m}\n    ${sprite}`);
    },
  };
};

// Warm the TCP+TLS connection to the Supabase origin before the app code runs.
// The student/admin views contact Supabase (auth + queries) on first paint, so a
// preconnect shaves the handshake off the critical path. The origin is read from
// the same env var the client uses (VITE_SUPABASE_URL) — never hardcoded — so the
// hint always matches the deployed backend. `crossorigin` is required because the
// requests carry the apikey/Authorization headers (CORS credentialed fetches).
const injectSupabasePreconnect = (origin) => ({
  name: "inject-supabase-preconnect",
  transformIndexHtml() {
    if (!origin) return [];
    return [
      {
        tag: "link",
        attrs: { rel: "preconnect", href: origin, crossorigin: "" },
        injectTo: "head-prepend",
      },
      {
        tag: "link",
        attrs: { rel: "dns-prefetch", href: origin },
        injectTo: "head-prepend",
      },
    ];
  },
});

// The HTML writes share and canonical URLs against the demo domain; each Vercel
// build (demo, pilot, previews) points them at the host that actually serves it.
const DEMO_ORIGIN = "https://demo.simplemanagepro.com";

export const siteOrigin = (env) => {
  const host =
    env.VERCEL_ENV === "production"
      ? env.VERCEL_PROJECT_PRODUCTION_URL
      : env.VERCEL_BRANCH_URL || env.VERCEL_URL;
  return host ? `https://${host}` : DEMO_ORIGIN;
};

const injectSiteOrigin = (origin) => ({
  name: "inject-site-origin",
  transformIndexHtml: {
    order: "pre",
    handler: (html) => html.replaceAll(DEMO_ORIGIN, origin),
  },
});

export default defineConfig(({ mode }) => {
  // Load VITE_* env so the preconnect origin tracks the configured backend.
  const env = loadEnv(mode, process.cwd(), "");
  const supabaseOrigin = env.VITE_SUPABASE_URL || "";

  return {
    plugins: [
      injectSiteOrigin(siteOrigin(env)),
      inlineSvgSprite(),
      injectSupabasePreconnect(supabaseOrigin),
    ],
    server: {
      port: 3000,
      open: true,
    },
    build: {
      outDir: "dist",
      emptyOutDir: true,
      target: "esnext",
      rolldownOptions: {
        input: {
          main: resolve(import.meta.dirname, "index.html"),
          login: resolve(import.meta.dirname, "login.html"),
          admin: resolve(import.meta.dirname, "admin.html"),
          teacher: resolve(import.meta.dirname, "teacher.html"),
          privacy: resolve(import.meta.dirname, "privacy.html"),
          terms: resolve(import.meta.dirname, "terms.html"),
          notFound: resolve(import.meta.dirname, "404.html"),
        },
        output: {
          // Split the Supabase SDK into its own long-lived vendor chunk. It's the
          // heaviest dependency (~230 KB) and shared by every page; isolating it
          // means routine app-code changes no longer bust its immutable cache
          // entry across deploys — returning visitors keep the cached copy.
          codeSplitting: {
            groups: [
              { name: "vendor-supabase", test: /node_modules[\\/]@supabase/ },
            ],
          },
        },
      },
    },
  };
});
