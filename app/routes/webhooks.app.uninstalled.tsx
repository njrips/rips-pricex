import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // Pause running tests + clear entitlement via Express API (cancel/uninstall policy)
  try {
    const apiBase = process.env.RIPSPRICEX_API_URL || "http://127.0.0.1:3456";
    await fetch(`${apiBase}/api/shops/uninstall`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Shop-Domain": shop,
      },
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
