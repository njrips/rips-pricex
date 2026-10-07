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

  if (session) {
    await db.session.deleteMany({ where: { shop } });
  }

  // Pause running tests + clear entitlement via Express API (cancel/uninstall
  // policy). A failure answers 500 so Shopify redelivers; swallowing it left
  // tests pricing shoppers until the background sweep next ran.
  try {
    const res = await fetch(`${expressApiBase()}/api/shops/uninstall`, {
      method: "POST",
      headers: internalServiceHeaders(shop),
      body: "{}",
    });
    if (!res.ok) {
      console.error(`Uninstall for ${shop} failed in the API with ${res.status}`);
      return new Response(null, { status: 500 });
    }
  } catch (err) {
    console.error("Failed to notify API of uninstall", err);
    return new Response(null, { status: 500 });
  }

  return new Response();
};
