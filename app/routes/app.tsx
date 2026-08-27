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
import ClassicRouteLoading from "../components/shared/ClassicRouteLoading";
import ClientOnly from "../components/shared/ClientOnly";
import ShopifyReady from "../components/shared/ShopifyReady";
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
      void shopify.support.registerHandler?.(null);
    };
  }, [navigate, pathname]);

  return null;
}

function AppBootSplash() {
  return (
    <div
      className="rpx-boot-splash"
      style={{
        minHeight: "100vh",
        margin: 0,
        background: "#f1f1f1",
        color: "#303030",
        fontFamily:
          '"Inter", -apple-system, BlinkMacSystemFont, "San Francisco", "Segoe UI", Roboto, sans-serif',
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      aria-busy="true"
      aria-live="polite"
    >
      <div style={{ textAlign: "center", padding: 24 }}>
        <div
          style={{
            width: 28,
            height: 28,
            margin: "0 auto 12px",
            borderRadius: "50%",
            border: "2.5px solid rgba(48, 48, 48, 0.15)",
            borderTopColor: "#303030",
            animation: "rpx-boot-spin 0.7s linear infinite",
          }}
        />
        <p style={{ margin: 0, fontSize: 14, fontWeight: 500 }}>Loading RipsPriceX…</p>
        <style>{`@keyframes rpx-boot-spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    </div>
  );
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);

  let entitled = process.env.RIPSPRICEX_DEV_ENTITLE_ALL === "true";
  let planHandle: string | null = null;
  const shop = session.shop;
  const accessToken = session.accessToken || "";
  const appHandle = process.env.SHOPIFY_APP_HANDLE || "ripspricex";
  const upgradeUrl = buildPricingPlansUrl(shop, appHandle);
  const devEntitleAll = process.env.RIPSPRICEX_DEV_ENTITLE_ALL === "true";

  // Shopify App Pricing welcome / redirect appends plan_handle (charge_id retired after 2026-04-28).
  const requestUrl = new URL(request.url);
  const planHandleFromQuery = (
    requestUrl.searchParams.get("plan_handle") ||
    requestUrl.searchParams.get("planHandle") ||
    ""
  ).trim();

  try {
    if (billing && typeof billing.check === "function") {
      const check = await billing.check({ isTest: true }).catch(() => null);
      if (check && (check as { hasActivePayment?: boolean }).hasActivePayment) {
        entitled = true;
        const subscriptions = (
          check as {
            appSubscriptions?: Array<{ name?: string; status?: string }>;
          }
        ).appSubscriptions;
        const active = Array.isArray(subscriptions)
          ? subscriptions.find((sub) =>
              ["ACTIVE", "active", "PENDING", "pending"].includes(
                String(sub?.status || ""),
              ),
            ) || subscriptions[0]
          : null;
        if (active?.name) {
          planHandle = String(active.name);
        } else {
          planHandle = "smart_pricing";
        }
      }
    }
  } catch {
    // Partner App Pricing may not be linked yet
  }

  if (planHandleFromQuery) {
    planHandle = planHandleFromQuery;
  }

  if (devEntitleAll && !planHandle) {
    planHandle = "dev_entitle_all";
  }

  const apiBase = process.env.RIPSPRICEX_API_URL || "http://127.0.0.1:3456";

  // Sync install + offline access token into Express Postgres shop_sessions
  // (required for catalog / cart-transform / Admin GraphQL from the API)
  try {
    const installRes = await fetch(`${apiBase}/api/shops/install`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Shop-Domain": shop,
        ...(accessToken ? { "X-Shopify-Access-Token": accessToken } : {}),
      },
      body: JSON.stringify({
        access_token: accessToken || undefined,
        scope: session.scope || process.env.SCOPES || process.env.SHOPIFY_SCOPES || undefined,
        refresh_scopes: !String(session.scope || "").includes("write_discounts"),
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!installRes.ok) {
      console.warn(
        "[ripspricex] shops/install sync failed",
        installRes.status,
        await installRes.text().catch(() => ""),
      );
    } else if (!accessToken) {
      console.warn(
        "[ripspricex] shops/install: no offline access token on session — Admin API calls will fail until re-auth",
      );
    }

    if (entitled) {
      const entitleRes = await fetch(`${apiBase}/api/billing/sync-entitlement`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Shop-Domain": shop,
        },
        body: JSON.stringify({
          entitled: true,
          status: "ACTIVE",
          planHandle: planHandle || "smart_pricing",
        }),
        signal: AbortSignal.timeout(8000),
      });
      if (!entitleRes.ok) {
        console.warn("[ripspricex] sync-entitlement failed", entitleRes.status);
      }
    }
  } catch (err) {
    console.warn(
      "[ripspricex] API sync error (is Express running on RIPSPRICEX_API_URL?)",
      err instanceof Error ? err.message : err,
    );
  }

  const staffEmail = String(
    (session as { email?: string | null }).email ||
      (
        session as {
          onlineAccessInfo?: { associated_user?: { email?: string | null } };
        }
      ).onlineAccessInfo?.associated_user?.email ||
      "",
  ).trim();

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

  useEffect(() => {
    setShopContext(data.shop, "/api");
  }, [data.shop]);

  // AppProvider must stay outside ClientOnly so the App Bridge <script> is in the
  // SSR HTML and window.shopify exists before TitleBar / NavMenu / redirects run.
  return (
    <AppProvider embedded apiKey={data.apiKey}>
      <ClientOnly fallback={<AppBootSplash />}>
        <ShopifyReady fallback={<AppBootSplash />}>
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
        </ShopifyReady>
      </ClientOnly>
    </AppProvider>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
