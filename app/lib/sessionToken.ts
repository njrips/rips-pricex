/**
 * Shopify App Bridge ID token for authenticating calls to our Express API.
 *
 * App Bridge attaches this automatically, but only to `fetch`. Anything using
 * XMLHttpRequest (axios) would otherwise reach the API with no proof of who is
 * asking, so both clients ask for the token explicitly.
 */

type AppBridgeGlobal = {
  idToken?: () => Promise<string>;
};

export async function getSessionToken(): Promise<string> {
  if (typeof window === "undefined") return "";
  const bridge = (window as unknown as { shopify?: AppBridgeGlobal }).shopify;
  if (!bridge || typeof bridge.idToken !== "function") return "";
  try {
    return String((await bridge.idToken()) || "");
  } catch {
    // Outside the Shopify admin there is no session to mint a token from. The
    // request still goes out, and the API decides how to answer it.
    return "";
  }
}

/**
 * Authorization header for an admin API request, or nothing when no session
 * token is available.
 */
export async function sessionAuthHeader(): Promise<Record<string, string>> {
  const token = await getSessionToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}
