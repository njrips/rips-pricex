import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import {
  expressApiBase,
  internalServiceHeaders,
} from "../utils/expressInternalApi.server";

const API_PATH_BY_TOPIC: Record<string, string> = {
  CUSTOMERS_DATA_REQUEST: "/api/privacy/customers-data-request",
  CUSTOMERS_REDACT: "/api/privacy/customers-redact",
  SHOP_REDACT: "/api/privacy/shop-redact",
};

/**
 * Mandatory privacy webhooks. `authenticate.webhook` answers 401 on a bad HMAC
 * before any of this runs. Anything short of a 2xx makes Shopify retry, so a
 * failed erase is reported rather than swallowed.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  const key = String(topic).toUpperCase().replace(/\//g, "_");
  const path = API_PATH_BY_TOPIC[key];
  if (!path) return new Response(null, { status: 200 });

  if (key === "SHOP_REDACT") {
    await db.session.deleteMany({ where: { shop } });
  }

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
