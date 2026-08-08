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
  try {
    await fetch(`${apiBase}/api/shops/install`, {
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
    }).catch(() => null);

    if (entitled) {
      await fetch(`${apiBase}/api/billing/dev-entitle`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Shop-Domain": shop,
        },
        body: JSON.stringify({
          status: "ACTIVE",
          planHandle: planHandle || "smart_pricing",
        }),
      }).catch(() => null);
    }
  } catch {
    // ignore
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

  setShopContext(data.shop, "/api");

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
