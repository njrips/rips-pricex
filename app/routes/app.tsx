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
  useSearchParams,
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
import PaymentRequiredNotice from "../components/PaymentRequiredNotice";
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
import { resolveAppHandle } from "../utils/appHandle.server";
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
      // The ticket form is its own view on Help's Support tab. Scroll to it when
      // it is on the page, and otherwise open that view by name — from the
      // ticket table or Help's other tab as much as from another page.
      if (pathname === "/app/help" || pathname === "/help") {
        const form = document.getElementById("help-new-ticket");
        if (form) {
          form.scrollIntoView({ block: "start", behavior: "smooth" });
          return;
        }
      }
      navigate(
        withCurrentEmbeddedSearch(search, "/app/help", { tab: "tickets", compose: "1" }),
      );
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
    .then(async res => (res.ok ? ((await res.json()) as CachedEntitlement) : null))
    .catch(() => null);

  const [cached, live] = await Promise.all([
    cachedRequest,
    fetchSubscriptionEntitlement(admin),
  ]);

  // Support access is ours, not Shopify's, so Shopify saying "not paying"
  // does not end it. It ends on its own date.
  const supportAccess = cached?.source === "support_access";
  // Partner development stores are free. Shopify's live answer decides; the
  // cached flag only stands in when Shopify did not answer in time.
  const developmentStore =
    typeof live?.developmentStore === "boolean"
      ? live.developmentStore
      : Boolean(cached?.developmentStore);

  if (live) {
    // Only write when Shopify disagrees with our copy, so a steady state does
    // not post on every page load. Compare against Shopify's part of the
    // answer: support access would otherwise look like a disagreement forever.
    if (!cached || shopifyCopyIsStale(cached, live)) {
      void pushEntitlementToExpress(shop, live, { source: "loader" }).catch(err => {
        console.warn(
          "[ripspricex] sync-entitlement error",
          err instanceof Error ? err.message : err,
        );
      });
    }
    if (!live.entitled && developmentStore) {
      return {
        entitled: true,
        planHandle: planHandleFromQuery || null,
        source: "development_store",
      };
    }
    if (!live.entitled && supportAccess) {
      return {
        entitled: true,
        planHandle: planHandleFromQuery || cached?.planHandle || null,
        source: "support_access",
      };
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
    source: developmentStore
      ? "development_store"
      : supportAccess
        ? "support_access"
        : cached
          ? "cache"
          : "unknown",
  };
}

type CachedEntitlement = {
  entitled?: boolean;
  shopifyEntitled?: boolean;
  developmentStore?: boolean;
  source?: string;
  planHandle?: string | null;
  billing?: {
    shopGid?: string | null;
    subscriptionGid?: string | null;
    currentPeriodEnd?: string | null;
  } | null;
};

function sameInstant(a: string | null | undefined, b: string | null | undefined) {
  const left = a ? new Date(a).getTime() : NaN;
  const right = b ? new Date(b).getTime() : NaN;
  if (Number.isNaN(left) || Number.isNaN(right)) return !a === !b;
  return left === right;
}

/** Whether what we stored from Shopify no longer matches what Shopify says. */
function shopifyCopyIsStale(
  cached: CachedEntitlement,
  live: Awaited<ReturnType<typeof fetchSubscriptionEntitlement>> & object,
) {
  const billing = cached.billing || {};
  const details = live.details || {};
  if (Boolean(cached.shopifyEntitled) !== live.entitled) return true;
  if (typeof live.developmentStore === "boolean" && Boolean(cached.developmentStore) !== live.developmentStore) {
    return true;
  }
  // Only what Shopify reported: a cancelled shop has no subscription in the
  // answer but keeps its last one on record, which is not a disagreement.
  if (details.shopGid && !billing.shopGid) return true;
  if (details.subscriptionGid && details.subscriptionGid !== billing.subscriptionGid) return true;
  return Boolean(details.currentPeriodEnd) && !sameInstant(details.currentPeriodEnd, billing.currentPeriodEnd);
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const started = Date.now();
  // Do not call billing.check() here. A 401 invalidates the offline session and
  // an App Pricing hang blocks the iframe on "Loading Priceify…". The
  // activeSubscriptions query in resolveEntitlement has neither failure mode.
  const { session, admin } = await authenticate.admin(request);

  const shop = session.shop;
  const accessToken = session.accessToken || "";
  const appHandleRequest = resolveAppHandle(admin);
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
  const appHandle = await appHandleRequest;
  const upgradeUrl = buildPricingPlansUrl(shop, appHandle);

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
    appHandle,
  });

  return {
    apiKey: process.env.SHOPIFY_API_KEY || "",
    shop,
    entitled,
    planHandle,
    upgradeUrl,
    // Shopify's plan page is a "page not found" until App Pricing plans exist in
    // the Partner Dashboard, and no API reports whether they do.
    pricingPlansReady:
      String(process.env.SHOPIFY_APP_PRICING_READY || "").trim().toLowerCase() === "true",
    isProductionBuild: process.env.NODE_ENV === "production",
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
  const [searchParams] = useSearchParams();
  const embeddedPath = (path: string) => withCurrentEmbeddedSearch(searchParams, path);

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
          <Link to={embeddedPath("/app")} rel="home">
            Tests
          </Link>
          <Link to={embeddedPath("/app/experiments/new")}>New test</Link>
          <Link to={embeddedPath("/app/setup")}>Store setup</Link>
          <Link to={embeddedPath("/app/settings")}>App settings</Link>
          <Link to={embeddedPath("/app/help")}>Help & docs</Link>
        </NavMenu>
        <SupportLinkHandler />
        <div data-palette="admin">
          <PaymentRequiredNotice />
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
