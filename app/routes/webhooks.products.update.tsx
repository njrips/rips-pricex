import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

/**
 * products/update — invalidate opportunity caches / reconcile running price tests (best-effort).
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);
  // Hook for future product-sync processor; acknowledge immediately.
  return new Response();
};
