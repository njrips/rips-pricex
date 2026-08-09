import { useEffect } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { NavMenu } from "@shopify/app-bridge-react";
import { AppProvider as PolarisAppProvider } from "@shopify/polaris";
import enTranslations from "@shopify/polaris/locales/en.json";
import "@shopify/polaris/build/esm/styles.css";

import { authenticate } from "../shopify.server";
import { setShopContext } from "../services/api";
import "../styles/classic-theme.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);

  let entitled = process.env.RIPSPRICEX_DEV_ENTITLE_ALL === "true";
  let planHandle: string | null = null;
  const shop = session.shop;
  const accessToken = session.accessToken || "";
  const storeHandle = shop.replace(/\.myshopify\.com$/i, "");
  const appHandle = process.env.SHOPIFY_APP_HANDLE || "ripspricex";
  const upgradeUrl = `https://admin.shopify.com/store/${storeHandle}/charges/${appHandle}/pricing_plans`;

  try {
    if (billing && typeof billing.check === "function") {
      const check = await billing.check({ isTest: true }).catch(() => null);
      if (check && (check as { hasActivePayment?: boolean }).hasActivePayment) {
        entitled = true;
      }
    }
  } catch {
    // Partner App Pricing may not be linked yet
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
        scope: process.env.SCOPES || process.env.SHOPIFY_SCOPES || undefined,
      }),
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
      const entitleRes = await fetch(`${apiBase}/api/billing/dev-entitle`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Shop-Domain": shop,
        },
        body: JSON.stringify({
          status: "ACTIVE",
          planHandle: planHandle || "smart_pricing",
        }),
      });
      if (!entitleRes.ok) {
        console.warn("[ripspricex] dev-entitle failed", entitleRes.status);
      }
    }
  } catch (err) {
    console.warn(
      "[ripspricex] API sync error (is Express running on RIPSPRICEX_API_URL?)",
      err instanceof Error ? err.message : err,
    );
  }

  return {
    apiKey: process.env.SHOPIFY_API_KEY || "",
    shop,
    entitled,
    planHandle,
    upgradeUrl,
    apiBase: "/api",
  };
};

export default function App() {
  const data = useLoaderData<typeof loader>();

  useEffect(() => {
    setShopContext(data.shop, "/api");
  }, [data.shop]);

  return (
    <AppProvider embedded apiKey={data.apiKey}>
      <PolarisAppProvider i18n={enTranslations}>
        <NavMenu>
          <Link to="/app" rel="home">
            Experiments
          </Link>
          <Link to="/app/experiments/new">Create</Link>
          <Link to="/app/setup">Setup</Link>
          <Link to="/app/billing">Billing</Link>
          <Link to="/app/settings">Settings</Link>
        </NavMenu>
        <div data-palette="orange-classic">
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
