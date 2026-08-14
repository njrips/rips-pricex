import type { LoginError } from "@shopify/shopify-app-react-router/server";
import { LoginErrorType } from "@shopify/shopify-app-react-router/server";

interface LoginErrorMessage {
  shop?: string;
}

export function loginErrorMessage(loginErrors: LoginError): LoginErrorMessage {
  if (loginErrors?.shop === LoginErrorType.MissingShop) {
    return { shop: "Enter your shop handle to open Admin." };
  } else if (loginErrors?.shop === LoginErrorType.InvalidShop) {
    return { shop: "Use your-store.myshopify.com — not a custom domain." };
  }

  return {};
}
