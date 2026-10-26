import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import {
  entitlementFromStatus,
  fetchSubscriptionEntitlement,
  pushEntitlementToExpress,
  type SubscriptionDetails,
} from "../utils/appSubscriptionEntitlement.server";

type SubscriptionPayload = {
  admin_graphql_api_id?: string;
  admin_graphql_api_shop_id?: string;
  name?: string;
  status?: string;
  created_at?: string;
  price?: string | number;
  currency?: string;
  interval?: string;
  plan_handle?: string;
};

function detailsFromPayload(subscription: SubscriptionPayload | undefined): SubscriptionDetails {
  return {
    shopGid: subscription?.admin_graphql_api_shop_id || null,
    subscriptionGid: subscription?.admin_graphql_api_id || null,
    subscriptionName: subscription?.name || null,
    createdAt: subscription?.created_at || null,
    price: subscription?.price ?? null,
    currency: subscription?.currency || null,
    interval: subscription?.interval || null,
  };
}

/**
 * The payload has no trial end or renewal date. Ask Shopify for them, and keep
 * them only if the answer is about the same subscription: by the time this
 * runs the shop may already be on a different one.
 */
async function withLiveDates(
  admin: Parameters<typeof fetchSubscriptionEntitlement>[0] | undefined,
  details: SubscriptionDetails,
): Promise<SubscriptionDetails> {
  if (!admin) return details;
  const live = await fetchSubscriptionEntitlement(admin, { timeoutMs: 4000 });
  const liveDetails = live?.details;
  if (!liveDetails || liveDetails.subscriptionGid !== details.subscriptionGid) {
    return { ...details, shopGid: details.shopGid || liveDetails?.shopGid || null };
  }
  return {
    ...details,
    test: liveDetails.test,
    trialEndsAt: liveDetails.trialEndsAt,
    currentPeriodEnd: liveDetails.currentPeriodEnd,
    interval: details.interval || liveDetails.interval,
    price: details.price ?? liveDetails.price,
    currency: details.currency || liveDetails.currency,
  };
}

/**
 * Shopify says a subscription changed.
 *
 * Without this the app only learned about a plan when the merchant next opened
 * it, which is the wrong way round for the case that matters: a merchant who
 * cancels stops opening the app, so their tests would have gone on pricing
 * shoppers indefinitely. The loader's query is the backstop for a missed
 * webhook; this is what makes the change prompt.
 *
 * Recording a lapse is all this needs to do. The cancel-policy sweep pauses
 * running tests for any shop whose entitlement is not current, so it takes the
 * tests off the storefront from here.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload, admin } = await authenticate.webhook(request);

  const subscription = (payload as { app_subscription?: SubscriptionPayload })?.app_subscription;
  const fromStatus = entitlementFromStatus(subscription?.status, subscription?.name);
  const details = await withLiveDates(admin, detailsFromPayload(subscription)).catch(() =>
    detailsFromPayload(subscription),
  );
  const entitlement = {
    ...fromStatus,
    planHandle: fromStatus.entitled ? subscription?.plan_handle || fromStatus.planHandle : null,
    details,
  };

  console.log(`Received ${topic} webhook for ${shop}`, {
    status: entitlement.status,
    entitled: entitlement.entitled,
  });

  try {
    await pushEntitlementToExpress(shop, entitlement, { source: "webhook" });
  } catch (err) {
    // Answering 500 asks Shopify to redeliver.
    console.error("Failed to sync subscription entitlement", err);
    return new Response("Failed to record subscription change", { status: 500 });
  }

  return new Response();
};
