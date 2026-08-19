import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
    const { payload, session, topic, shop } = await authenticate.webhook(request);
    console.log(`Received ${topic} webhook for ${shop}`);

    const current = payload.current as string[];
    const scope = Array.isArray(current) ? current.filter(Boolean).join(",") : "";
    if (session) {
        await db.session.update({
            where: {
                id: session.id
            },
            data: {
                scope,
            },
        });
    }
    try {
      const apiBase = process.env.RIPSPRICEX_API_URL || "http://127.0.0.1:3456";
      const accessToken = session?.accessToken || undefined;
      await fetch(`${apiBase}/api/shops/install`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Shop-Domain": shop,
          ...(accessToken ? { "X-Shopify-Access-Token": accessToken } : {}),
        },
        body: JSON.stringify({
          scope,
          access_token: accessToken,
          refresh_scopes: Boolean(accessToken),
        }),
      });
    } catch (err) {
      console.error("Failed to sync Express shop_sessions scopes", err);
    }
    return new Response();
};
