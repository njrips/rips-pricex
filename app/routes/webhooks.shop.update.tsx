import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import {
  fetchSubscriptionEntitlement,
  pushEntitlementToExpress,
} from "../utils/appSubscriptionEntitlement.server";

/**
 * Shopify says the shop changed, which includes a development store moving to
 * a paid Shopify plan. Development stores use Priceify free, so that move is
 * when the store needs a Priceify plan; Shopify's guide for free development
 * store access names this webhook for it.
 *
 * The payload's plan name is not the flag, so ask Shopify for
 * `shop.plan.partnerDevelopment` with the same query the app loader uses. The
 * daily shop plan check on the server catches anything this misses.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, admin } = await authenticate.webhook(request);
  if (!admin) return new Response();

  const live = await fetchSubscriptionEntitlement(admin, { timeoutMs: 4000 });
  if (!live || typeof live.developmentStore !== "boolean") {
    return new Response();
  }

  console.log(`Received ${topic} webhook for ${shop}`, {
    developmentStore: live.developmentStore,
    entitled: live.entitled,
  });

  try {
    await pushEntitlementToExpress(shop, live, { source: "webhook" });
  } catch (err) {
    // Answering 500 asks Shopify to redeliver.
    console.error("Failed to sync shop plan", err);
    return new Response("Failed to record shop change", { status: 500 });
  }

  return new Response();
};
