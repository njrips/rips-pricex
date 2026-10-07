import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import {
  expressApiBase,
  internalServiceHeaders,
} from "../utils/expressInternalApi.server";

const API_PATH_BY_TOPIC: Record<string, string> = {
  ORDERS_CREATE: "/api/orders/created",
  ORDERS_CANCELLED: "/api/orders/cancelled",
  REFUNDS_CREATE: "/api/orders/refunded",
};

/**
 * orders/create, orders/cancelled and refunds/create — the purchases price
 * tests are judged on.
 * Shopify no longer runs the storefront script on the order-status page, so
 * this is the only dependable record of an order. Anything short of a 2xx makes
 * Shopify redeliver, and the API records each order once, so a failure is
 * reported rather than swallowed.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  const key = String(topic).toUpperCase().replace(/\//g, "_");
  const path = API_PATH_BY_TOPIC[key];
  if (!path) return new Response(null, { status: 200 });

  try {
    const res = await fetch(`${expressApiBase()}${path}`, {
      method: "POST",
      headers: internalServiceHeaders(shop),
      body: JSON.stringify(payload ?? {}),
    });
    if (!res.ok) {
      console.error(`${topic} for ${shop} failed in the API with ${res.status}`);
      return new Response(null, { status: 500 });
    }
  } catch (err) {
    console.error(`${topic} for ${shop} could not reach the API`, err);
    return new Response(null, { status: 500 });
  }
  return new Response(null, { status: 200 });
};
