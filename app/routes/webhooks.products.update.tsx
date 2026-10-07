import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import {
  expressApiBase,
  internalServiceHeaders,
} from "../utils/expressInternalApi.server";

/**
 * products/update — drops the shop's cached opportunity list so the next test
 * starts from the catalog's current prices. Best-effort: the cache also expires
 * on its own, so a failed call is not worth a redelivery.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop } = await authenticate.webhook(request);
  try {
    await fetch(`${expressApiBase()}/api/shops/products-updated`, {
      method: "POST",
      headers: internalServiceHeaders(shop),
      body: "{}",
    });
  } catch (err) {
    console.error("Failed to clear product caches", err);
  }
  return new Response();
};
