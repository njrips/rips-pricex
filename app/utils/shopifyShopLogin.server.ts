import { login } from "../shopify.server";
import { coerceShopifyShopInput } from "./shopifyAdmin";
import { loginErrorMessage } from "../routes/auth.login/error.server";

/** Coerce shop, then run Shopify login() so handle / Admin URL pastes succeed. */
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
  const errors = loginErrorMessage(await login(forwarded));
  return { shop, errors };
}
