import { useEffect } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import {
  isRouteErrorResponse,
  Link,
  Outlet,
  useLoaderData,
  useLocation,
  useNavigate,
  useRouteError,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { NavMenu } from "@shopify/app-bridge-react";
import { AppProvider as PolarisAppProvider } from "@shopify/polaris";
import enTranslations from "@shopify/polaris/locales/en.json";
import "@shopify/polaris/build/esm/styles.css";

import { authenticate } from "../shopify.server";
import { setShopContext } from "../services/api";
import { internalServiceHeaders } from "../utils/expressInternalApi.server";
import {
  fetchSubscriptionEntitlement,
  pushEntitlementToExpress,
} from "../utils/appSubscriptionEntitlement.server";
import ClassicRouteLoading from "../components/shared/ClassicRouteLoading";
import {
  EmbeddedAppErrorFallback,
  EmbeddedAppLoadingFallback,
} from "../components/shared/EmbeddedAppErrorFallback";
import {
  isShopifyRedirectResponse,
  shouldRenderShopifyBoundaryHtml,
  withCurrentEmbeddedSearch,
} from "../utils/shopifyEmbeddedSearch";
import { buildPricingPlansUrl } from "../utils/pricingPlansUrl";
import "../styles/classic-theme.css";

function SupportLinkHandler() {
  const navigate = useNavigate();
  const { pathname, search } = useLocation();

  useEffect(() => {
    const shopify = window.shopify as
      | { support?: { registerHandler?: (handler: (() => void) | null) => Promise<void> | void } }
      | undefined;
    if (!shopify?.support?.registerHandler) return undefined;
    void shopify.support.registerHandler(() => {
      // Help is tabbed, so the ticket form only exists while the Support tab is
      // open. Scroll to it when it is on the page, and otherwise ask for that
      // tab by name — from Help's other tab as much as from another page.
      if (pathname === "/app/help" || pathname === "/help") {
        const form = document.getElementById("help-new-ticket");
        if (form) {
          form.scrollIntoView({ block: "start", behavior: "smooth" });
          return;
        }
      }
      navigate(withCurrentEmbeddedSearch(search, "/app/help", { tab: "tickets" }));
    });
    return () => {
      void shopify.support?.registerHandler?.(null);
    };
  }, [navigate, pathname, search]);

  return null;
}

function syncShopIntoExpressApi({
  apiBase,
  shop,
  accessToken,
  scope,
}: {
  apiBase: string;
  shop: string;
  accessToken: string;
  scope: string;
}) {
  const headers: Record<string, string> = internalServiceHeaders(
    shop,
    accessToken ? { "X-Shopify-Access-Token": accessToken } : {},
  );

  void fetch(`${apiBase}/api/shops/install`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      access_token: accessToken || undefined,
      scope: scope || undefined,
      refresh_scopes: !scope.includes("write_discounts"),
    }),
    signal: AbortSignal.timeout(8000),
  }).catch((err) => {
    console.warn(
      "[ripspricex] shops/install sync error",
      err instanceof Error ? err.message : err,
    );
  });
}

/**
 * What this shop is entitled to, asked of Shopify and of our own cache at the
 * same time.
 *
 * Shopify is the authority and the cache is the fallback, because only one of
 * them can be wrong in the direction that matters: our copy goes stale the
 * moment a merchant subscribes or cancels, and it was previously the only
 * thing consulted.
 *
 * The two run concurrently rather than in sequence so the worst case is the
 * slower timeout instead of the sum of both. Neither is allowed to fail the
 * loader: a first paint without entitlement beats a hung Admin iframe.
 */
async function resolveEntitlement({
  apiBase,
  shop,
  admin,
  planHandleFromQuery,
}: {
  apiBase: string;
  shop: string;
  admin: Parameters<typeof fetchSubscriptionEntitlement>[0];
  planHandleFromQuery: string;
}): Promise<{ entitled: boolean; planHandle: string | null; source: string }> {
  const cachedRequest = fetch(`${apiBase}/api/billing/status`, {
    headers: internalServiceHeaders(shop),
    signal: AbortSignal.timeout(1500),
  })
    .then(async res =>
      res.ok
        ? ((await res.json()) as { entitled?: boolean; planHandle?: string | null })
        : null,
    )
    .catch(() => null);

  const [cached, live] = await Promise.all([
    cachedRequest,
    fetchSubscriptionEntitlement(admin),
  ]);

  const operatorDevPlan =
    String(cached?.planHandle || "")
      .trim()
      .toLowerCase() === "dev" && Boolean(cached?.entitled);

  if (live) {
    if (operatorDevPlan && !live.entitled) {
      return {
        entitled: true,
        planHandle: planHandleFromQuery || "dev",
        source: "dev_plan",
      };
    }
    // Only write when Shopify disagrees with our copy, so a steady state does
    // not post on every page load.
    if (Boolean(cached?.entitled) !== live.entitled) {
      void pushEntitlementToExpress(shop, live).catch(err => {
        console.warn(
          "[ripspricex] sync-entitlement error",
          err instanceof Error ? err.message : err,
        );
      });
    }
    return {
      entitled: live.entitled,
      planHandle: planHandleFromQuery || live.planHandle || null,
      source: "shopify",
    };
  }

  return {
    entitled: Boolean(cached?.entitled),
    planHandle: planHandleFromQuery || cached?.planHandle || null,
    source: cached ? "cache" : "unknown",
  };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const started = Date.now();
  // Do not call billing.check() here. A 401 invalidates the offline session and
  // an App Pricing hang blocks the iframe on "Loading Priceify…". The
  // activeSubscriptions query in resolveEntitlement has neither failure mode.
  const { session, admin } = await authenticate.admin(request);

  const shop = session.shop;
  const accessToken = session.accessToken || "";
  const appHandle = process.env.SHOPIFY_APP_HANDLE || "ripspricex";
  const upgradeUrl = buildPricingPlansUrl(shop, appHandle);
  // Mirrors devEntitleAllEnabled on the server: the local-pilot unlock ships
  // switched on in .env.example, so production must ignore it or a copied env
  // would unlock the paid tiers for every install.
  const devEntitleAll =
    process.env.RIPSPRICEX_DEV_ENTITLE_ALL === "true" &&
    String(process.env.NODE_ENV || "").toLowerCase() !== "production";
  const apiBase = process.env.RIPSPRICEX_API_URL || "http://127.0.0.1:3456";
  const scope = String(
    session.scope || process.env.SCOPES || process.env.SHOPIFY_SCOPES || "",
  );

  const requestUrl = new URL(request.url);
  const planHandleFromQuery = (
    requestUrl.searchParams.get("plan_handle") ||
    requestUrl.searchParams.get("planHandle") ||
    ""
  ).trim();

  let entitled = devEntitleAll;
  let planHandle: string | null = planHandleFromQuery || (devEntitleAll ? "dev_entitle_all" : null);
  let entitlementSource = devEntitleAll ? "dev_entitle_all" : "";

  if (!entitled) {
    const resolved = await resolveEntitlement({
      apiBase,
      shop,
      admin,
      planHandleFromQuery,
    });
    entitled = resolved.entitled;
    planHandle = resolved.planHandle;
    entitlementSource = resolved.source;
  }

  syncShopIntoExpressApi({ apiBase, shop, accessToken, scope });

  const staffEmail = String(
    (session as { email?: string | null }).email ||
      (
        session as {
          onlineAccessInfo?: { associated_user?: { email?: string | null } };
        }
      ).onlineAccessInfo?.associated_user?.email ||
      "",
  ).trim();

  console.info("[ripspricex] /app loader ready", {
    shop,
    ms: Date.now() - started,
    entitled,
    // Worth logging: "cache" on a shop that should be paying means the
    // activeSubscriptions query is timing out, and the merchant is seeing a
    // stale answer rather than a wrong one.
    entitlementSource,
  });

  return {
    apiKey: process.env.SHOPIFY_API_KEY || "",
    shop,
    entitled,
    planHandle,
    upgradeUrl,
    apiBase: "/api",
    staffEmail,
    devEntitleAll,
    // Dev-only; empty in production. Powers price-surface unlock without showing a password field.
    devStorefrontPassword: String(
      process.env.VITE_RIPX_DEV_STOREFRONT_PASSWORD ||
        process.env.RIPX_DEV_STOREFRONT_PASSWORD ||
        "",
    ).trim(),
  };
};

export default function App() {
  const data = useLoaderData<typeof loader>();

  // Set during render, not in an effect: React runs child effects before parent
  // effects, so an effect here would land after the child routes have already
  // fired their first API calls.
  if (typeof window !== "undefined") {
    setShopContext(data.shop, "/api");
  }

  // Render the real UI on the server. NavMenu / TitleBar are App Bridge custom
  // elements that upgrade once app-bridge.js runs, so nothing here may block the
  // first paint on `window.shopify` — that is what stranded the iframe on a splash.
  return (
    <AppProvider embedded apiKey={data.apiKey}>
      <PolarisAppProvider i18n={enTranslations}>
        <NavMenu>
          <Link to="/app" rel="home">
            Tests
          </Link>
          <Link to="/app/experiments/new">New test</Link>
          <Link to="/app/setup">Store setup</Link>
          <Link to="/app/settings">App settings</Link>
          <Link to="/app/help">Help & docs</Link>
        </NavMenu>
        <SupportLinkHandler />
        <div data-palette="admin">
          <ClassicRouteLoading />
          <Outlet context={data} />
        </div>
      </PolarisAppProvider>
    </AppProvider>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();

  if (shouldRenderShopifyBoundaryHtml(error)) {
    return boundary.error(error);
  }

  if (isRouteErrorResponse(error)) {
    const body = typeof error.data === 'string' ? error.data.trim() : '';
    if (isShopifyRedirectResponse(error) || !body) {
      return <EmbeddedAppLoadingFallback />;
    }
    return (
      <EmbeddedAppErrorFallback
        title={`Request failed (${error.status})`}
        message={body || error.statusText || 'The app could not load this page.'}
      />
    );
  }

  return (
    <EmbeddedAppErrorFallback
      message={error instanceof Error ? error.message : 'The app hit an unexpected error.'}
    />
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
