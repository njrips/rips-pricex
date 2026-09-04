import { useEffect } from "react";
import type { HeadersFunction } from "react-router";
import {
  isRouteErrorResponse,
  Link,
  Outlet,
  useLoaderData,
  useLocation,
  useMatches,
  useRouteError,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import {
  DEFAULT_APP_STORE_LISTING_URL,
  resolveAppStoreListingUrlFromEnv,
} from "../utils/appStoreListingUrl";
import { isShopifySessionBounce } from "../utils/shopifyEmbeddedSearch";
import PriceifyShell from "../components/public/priceify/PriceifyShell";
import { publicErrorTitle } from "../components/public/publicMeta";

export const loader = async () => {
  return {
    storeUrl: resolveAppStoreListingUrlFromEnv(),
    supportEmail: String(process.env.RIPSPRICEX_SUPPORT_EMAIL || "").trim(),
  };
};

export type PublicOutletContext = {
  storeUrl: string;
  supportEmail: string;
};

export default function PublicLayout() {
  const data = useLoaderData<typeof loader>();
  const { pathname } = useLocation();

  return (
    <PriceifyShell
      storeUrl={data.storeUrl}
      fullBleed={pathname === "/" || pathname.startsWith("/docs")}
    >
      <Outlet context={data} />
    </PriceifyShell>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

function usePublicStoreUrl() {
  const matches = useMatches();
  for (const match of matches) {
    const data = match.data as PublicOutletContext | undefined;
    if (data && typeof data.storeUrl === "string" && data.storeUrl) {
      return data.storeUrl;
    }
  }
  return DEFAULT_APP_STORE_LISTING_URL;
}

function PublicErrorTitle({ notFound }: { notFound: boolean }) {
  const title = publicErrorTitle(notFound);
  useEffect(() => {
    document.title = title;
  }, [title]);
  return null;
}

export function ErrorBoundary() {
  const error = useRouteError();
  // Read the store URL before the bounce check: skipping a hook on some renders
  // changes the hook order and React would crash here with a hooks error that
  // hides whatever error the boundary was rendered to report.
  const storeUrl = usePublicStoreUrl();
  if (isShopifySessionBounce(error)) {
    // 401/410 or thrown App Bridge HTML must reach the iframe, not Priceify chrome.
    return boundary.error(error);
  }
  const notFound = isRouteErrorResponse(error) && error.status === 404;

  return (
    <PriceifyShell storeUrl={storeUrl}>
      <PublicErrorTitle notFound={notFound} />
      <section className="hero">
        <p className="eyebrow">PRICEIFY</p>
        <h1 className="title">{notFound ? "Page not found" : "Something went wrong"}</h1>
        <p className="subtitle">
          {notFound
            ? "That page is not in this site. Privacy and the product page are still here."
            : "The public site hit an error. Try the product page or install from the App Store."}
        </p>
        <Link to="/" className="px-btn px-btn--brand">
          Back to Priceify
        </Link>
      </section>
    </PriceifyShell>
  );
}
