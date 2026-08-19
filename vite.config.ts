import { reactRouter } from "@react-router/dev/vite";
import { defineConfig, loadEnv, type UserConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

// Related: https://github.com/remix-run/remix/issues/2835#issuecomment-1144102176
// Replace the HOST env var with SHOPIFY_APP_URL so that it doesn't break the Vite server.
// The CLI will eventually stop passing in HOST,
// so we can remove this workaround after the next major release.
if (
  process.env.HOST &&
  (!process.env.SHOPIFY_APP_URL ||
    process.env.SHOPIFY_APP_URL === process.env.HOST)
) {
  process.env.SHOPIFY_APP_URL = process.env.HOST;
  delete process.env.HOST;
}

const host = new URL(process.env.SHOPIFY_APP_URL || "http://localhost")
  .hostname;

let hmrConfig;
if (host === "localhost") {
  hmrConfig = {
    protocol: "ws",
    host: "localhost",
    port: 64999,
    clientPort: 64999,
  };
} else {
  hmrConfig = {
    protocol: "wss",
    host: host,
    port: parseInt(process.env.FRONTEND_PORT!) || 8002,
    clientPort: 443,
  };
}

export default defineConfig(({ mode }) => {
  // Dev-only: password-protected storefront unlock for price-surface Pick PDP / auto-map.
  // Prefer VITE_*; fall back to RIPX_* so one .env value covers Express + admin UI.
  const env = loadEnv(mode, process.cwd(), "");
  const devStorefrontPassword = String(
    env.VITE_RIPX_DEV_STOREFRONT_PASSWORD ||
      process.env.VITE_RIPX_DEV_STOREFRONT_PASSWORD ||
      env.RIPX_DEV_STOREFRONT_PASSWORD ||
      process.env.RIPX_DEV_STOREFRONT_PASSWORD ||
      "",
  ).trim();
  if (devStorefrontPassword && !process.env.VITE_RIPX_DEV_STOREFRONT_PASSWORD) {
    process.env.VITE_RIPX_DEV_STOREFRONT_PASSWORD = devStorefrontPassword;
  }

  return {
    // Expose to import.meta.env for price-surface picker (never ship a hardcoded password).
    define: {
      "import.meta.env.VITE_RIPX_DEV_STOREFRONT_PASSWORD":
        JSON.stringify(devStorefrontPassword),
    },
    server: {
      allowedHosts: [host],
      cors: {
        preflightContinue: true,
      },
      port: Number(process.env.PORT || 3000),
      hmr: hmrConfig,
      fs: {
        // See https://vitejs.dev/config/server-options.html#server-fs-allow for more information
        allow: ["app", "node_modules"],
      },
      proxy: (() => {
        const target = process.env.RIPSPRICEX_API_URL || "http://127.0.0.1:3456";
        const configure = (proxy: {
          on: (event: string, fn: (...args: unknown[]) => void) => void;
        }) => {
          proxy.on("proxyReq", (proxyReq: unknown, req: unknown) => {
            const request = req as {
              headers?: Record<string, string | undefined>;
            };
            const outgoing = proxyReq as {
              setHeader: (k: string, v: string) => void;
            };
            const reqHost = request.headers?.host;
            if (reqHost) {
              outgoing.setHeader("X-Forwarded-Host", String(reqHost));
            }
            const proto = request.headers?.["x-forwarded-proto"] || "https";
            outgoing.setHeader("X-Forwarded-Proto", String(proto));
          });
        };
        return {
          // Express health (tunnel / Cloudflare → Vite → API)
          "/health": { target, changeOrigin: true, xfwd: true, configure, timeout: 45000 },
          // Admin + app-proxy /api → Express (keep public Host for storefront apiUrl)
          "/api": {
            target,
            changeOrigin: true,
            xfwd: true,
            configure,
            timeout: 45000,
            proxyTimeout: 45000,
          },
        };
      })(),
    },
    resolve: {
      alias: {
        // Classic RipX code imports react-router-dom; RR7 uses react-router
        "react-router-dom": "react-router",
      },
      dedupe: ["react", "react-dom", "react-router"],
    },
    plugins: [reactRouter(), tsconfigPaths()],
    build: {
      assetsInlineLimit: 0,
    },
    optimizeDeps: {
      include: ["@shopify/app-bridge-react", "@shopify/polaris", "axios"],
    },
  } satisfies UserConfig;
});
