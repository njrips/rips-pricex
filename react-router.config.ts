import type { Config } from "@react-router/dev/config";
import { loadEnv } from "vite";

/**
 * Hosts allowed to submit React Router actions (the Help page's ticket and
 * reply forms).
 *
 * React Router refuses an action whose `Origin` differs from the request URL.
 * Behind the HTTPS proxy `react-router-serve` rebuilds that URL as `http://`
 * (it never trusts X-Forwarded-Proto), so the browser's `https://` origin
 * never matched and every form post came back as a 400.
 */
function appHosts(): string[] {
  const env = {
    ...loadEnv(process.env.NODE_ENV === "development" ? "development" : "production", process.cwd(), ""),
    ...process.env,
  };
  const hosts = new Set<string>();
  for (const raw of [env.SHOPIFY_APP_URL, env.HOST, env.APP_URL]) {
    try {
      const host = raw ? new URL(String(raw).trim()).host : "";
      if (host) hosts.add(host);
    } catch {
      // Not a URL; nothing to allow.
    }
  }
  return [...hosts];
}

export default {
  allowedActionOrigins: appHosts(),
} satisfies Config;
