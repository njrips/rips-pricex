/**
 * This app's Partner handle, which the Shopify App Pricing page is addressed by
 * (`/charges/{handle}/pricing_plans`). A wrong handle there is a Shopify
 * "page not found", and the handle differs between the dev and production
 * apps while SHOPIFY_APP_HANDLE is easy to leave unset, so Shopify is asked.
 */

export const APP_HANDLE_QUERY = `#graphql
  query PriceifyAppHandle {
    currentAppInstallation {
      app {
        handle
      }
    }
  }
`;

export const DEFAULT_APP_HANDLE = "ripspricex";

type AdminGraphqlClient = {
  graphql: (query: string) => Promise<Response>;
};

/** One app per process, and its handle does not change while it runs. */
let resolvedHandle: string | null = null;

export function resetAppHandleCacheForTests() {
  resolvedHandle = null;
}

export async function resolveAppHandle(
  admin: AdminGraphqlClient | null | undefined,
  {
    timeoutMs = 1500,
    configured = process.env.SHOPIFY_APP_HANDLE,
  }: { timeoutMs?: number; configured?: string } = {},
): Promise<string> {
  if (resolvedHandle) return resolvedHandle;
  const fallback = String(configured || "").trim() || DEFAULT_APP_HANDLE;
  if (!admin?.graphql) return fallback;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const expired = Symbol("timeout");
    const settled = await Promise.race([
      admin.graphql(APP_HANDLE_QUERY).then(res => res.json()),
      new Promise<typeof expired>(resolve => {
        timer = setTimeout(() => resolve(expired), timeoutMs);
      }),
    ]);
    if (settled === expired) return fallback;
    const body = settled as {
      data?: { currentAppInstallation?: { app?: { handle?: string | null } | null } | null };
    };
    const handle = String(body?.data?.currentAppInstallation?.app?.handle || "").trim();
    if (!handle) return fallback;
    resolvedHandle = handle;
    return handle;
  } catch {
    return fallback;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
