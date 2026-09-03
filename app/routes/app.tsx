import { useEffect } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, Outlet, useLoaderData, useLocation, useNavigate, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { NavMenu } from "@shopify/app-bridge-react";
import { AppProvider as PolarisAppProvider } from "@shopify/polaris";
import enTranslations from "@shopify/polaris/locales/en.json";
import "@shopify/polaris/build/esm/styles.css";

import { authenticate } from "../shopify.server";
import { setShopContext } from "../services/api";
import { internalServiceHeaders } from "../utils/expressInternalApi.server";
import ClassicRouteLoading from "../components/shared/ClassicRouteLoading";
import { buildPricingPlansUrl } from "../utils/pricingPlansUrl";
import "../styles/classic-theme.css";

function SupportLinkHandler() {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  useEffect(() => {
    const shopify = window.shopify as
      | { support?: { registerHandler?: (handler: (() => void) | null) => Promise<void> | void } }
      | undefined;
    if (!shopify?.support?.registerHandler) return undefined;
    void shopify.support.registerHandler(() => {
      if (pathname === "/app/help" || pathname === "/help") {
        document.getElementById("help-new-ticket")?.scrollIntoView({
          block: "start",
          behavior: "smooth",
        });
        return;
      }
      navigate("/app/help");
    });
    return () => {
      void shopify.support?.registerHandler?.(null);
    };
  }, [navigate, pathname]);

  return null;
}

function syncShopIntoExpressApi({
  apiBase,
  shop,
  accessToken,
  scope,
  entitled,
  planHandle,
}: {
  apiBase: string;
  shop: string;
  accessToken: string;
  scope: string;
  entitled: boolean;
  planHandle: string | null;
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

  if (!entitled) return;

  void fetch(`${apiBase}/api/billing/sync-entitlement`, {
    method: "POST",
    headers: internalServiceHeaders(shop),
    body: JSON.stringify({
      entitled: true,
      status: "ACTIVE",
      planHandle: planHandle || "smart_pricing",
    }),
    signal: AbortSignal.timeout(8000),
  }).catch((err) => {
    console.warn(
      "[ripspricex] sync-entitlement error",
      err instanceof Error ? err.message : err,
    );
  });
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const started = Date.now();
  // Do not call billing.check() here. A 401 invalidates the offline session and
  // an App Pricing hang blocks the iframe on "Loading Pricify…".
  const { session } = await authenticate.admin(request);

  const shop = session.shop;
  const accessToken = session.accessToken || "";
  const appHandle = process.env.SHOPIFY_APP_HANDLE || "ripspricex";
  const upgradeUrl = buildPricingPlansUrl(shop, appHandle);
  const devEntitleAll = process.env.RIPSPRICEX_DEV_ENTITLE_ALL === "true";
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

  if (!entitled) {
    try {
      const statusRes = await fetch(`${apiBase}/api/billing/status`, {
        headers: internalServiceHeaders(shop),
        signal: AbortSignal.timeout(1500),
      });
      if (statusRes.ok) {
        const status = (await statusRes.json()) as {
          entitled?: boolean;
          planHandle?: string | null;
        };
        entitled = Boolean(status.entitled);
        if (!planHandle && status.planHandle) {
          planHandle = String(status.planHandle);
        }
      }
    } catch {
      // First paint without entitlement is better than a hung Admin iframe.
    }
  }

  syncShopIntoExpressApi({
    apiBase,
    shop,
    accessToken,
    scope,
    entitled,
    planHandle,
  });

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
            Experiments
          </Link>
          <Link to="/app/experiments/new">Create</Link>
          <Link to="/app/setup">Setup</Link>
          <Link to="/app/settings">Settings</Link>
          <Link to="/app/help">Help</Link>
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
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
