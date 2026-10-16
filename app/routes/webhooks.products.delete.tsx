import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import {
  expressApiBase,
  internalServiceHeaders,
} from "../utils/expressInternalApi.server";

/**
 * products/delete — ends the tests still pricing the deleted product and drops
 * the shop's cached product list, which would otherwise keep offering it for
 * hours. Anything short of a 2xx makes Shopify redeliver, and settling a test
 * twice changes nothing, so a failure is reported rather than swallowed.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload } = await authenticate.webhook(request);
  try {
    const res = await fetch(`${expressApiBase()}/api/shops/products-deleted`, {
      method: "POST",
      headers: internalServiceHeaders(shop),
      body: JSON.stringify(payload ?? {}),
    });
    if (!res.ok) {
      console.error(`products/delete for ${shop} failed in the API with ${res.status}`);
      return new Response(null, { status: 500 });
    }
  } catch (err) {
    console.error(`products/delete for ${shop} could not reach the API`, err);
    return new Response(null, { status: 500 });
  }
  return new Response(null, { status: 200 });
};
