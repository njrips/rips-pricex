import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import {
  entitlementFromStatus,
  pushEntitlementToExpress,
} from "../utils/appSubscriptionEntitlement.server";

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
  const { shop, topic, payload } = await authenticate.webhook(request);

  const subscription = (payload as { app_subscription?: { status?: string; name?: string } })
    ?.app_subscription;
  const entitlement = entitlementFromStatus(subscription?.status, subscription?.name);

  console.log(`Received ${topic} webhook for ${shop}`, {
    status: entitlement.status,
    entitled: entitlement.entitled,
  });

  try {
    await pushEntitlementToExpress(shop, entitlement);
  } catch (err) {
    // Answering 500 asks Shopify to redeliver. The previous uninstall handler
    // swallowed its failure instead, which left the app's own record of the
    // shop untouched with no second attempt.
    console.error("Failed to sync subscription entitlement", err);
    return new Response("Failed to record subscription change", { status: 500 });
  }

  return new Response();
};
