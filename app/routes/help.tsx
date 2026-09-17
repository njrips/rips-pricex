import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { isRouteErrorResponse, redirect, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  EmbeddedAppErrorFallback,
  EmbeddedAppLoadingFallback,
} from "../components/shared/EmbeddedAppErrorFallback";
import {
  isShopifyRedirectResponse,
  shouldRenderShopifyBoundaryHtml,
  withEmbeddedSearch,
} from "../utils/shopifyEmbeddedSearch";

/** Shopify support_link `app://help` lands here; Help UI lives under /app/help. */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  throw redirect(withEmbeddedSearch(request, "/app/help"));
};

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
        message={body || error.statusText || 'The app could not open Help.'}
      />
    );
  }

  return (
    <EmbeddedAppErrorFallback
      message={error instanceof Error ? error.message : 'The app could not open Help.'}
    />
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
