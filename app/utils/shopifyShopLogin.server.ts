import { login } from "../shopify.server";
import { coerceShopifyShopInput } from "./shopifyAdmin";

/** Coerce shop, then run Shopify login() for CLI / OAuth POST (no HTML login page). */
export async function runShopLogin(request: Request) {
  const formData = await request.formData();
  const shop = coerceShopifyShopInput(String(formData.get("shop") || ""));
  formData.set("shop", shop);
  const headers = new Headers(request.headers);
  headers.delete("content-type");
  const forwarded = new Request(request.url, {
    method: "POST",
    headers,
    body: formData,
  });
  return login(forwarded);
}
