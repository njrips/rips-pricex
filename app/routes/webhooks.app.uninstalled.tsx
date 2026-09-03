import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import {
  expressApiBase,
  internalServiceHeaders,
} from "../utils/expressInternalApi.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // Pause running tests + clear entitlement via Express API (cancel/uninstall policy)
  try {
    await fetch(`${expressApiBase()}/api/shops/uninstall`, {
      method: "POST",
      headers: internalServiceHeaders(shop),
      body: "{}",
    });
  } catch (err) {
    console.error("Failed to notify API of uninstall", err);
  }

  if (session) {
    await db.session.deleteMany({ where: { shop } });
  }

  return new Response();
};
