import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { redirect, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { withEmbeddedSearch } from "../utils/shopifyEmbeddedSearch";

/** Shopify support_link `app://help` lands here; Help UI lives under /app/help. */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  throw redirect(withEmbeddedSearch(request, "/app/help"));
};

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
