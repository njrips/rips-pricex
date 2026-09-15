import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";

import { login } from "../../shopify.server";
import { runShopLogin } from "../../utils/shopifyShopLogin.server";

/** Shopify OAuth / CLI entry — no public shop-domain form (merchants use App Store). */
function throwLoginResult(result: unknown): never {
  if (result instanceof Response) {
    throw result;
  }
  throw redirect("/");
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  throwLoginResult(await login(request));
};

export const action = async ({ request }: ActionFunctionArgs) => {
  throwLoginResult(await runShopLogin(request));
};
