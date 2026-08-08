import { useCallback } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";

/**
 * Redirect merchant to Shopify App Pricing plan selection (breaks out of iframe).
 */
export function useUpgradeRedirect(upgradeUrl: string) {
  const shopify = useAppBridge();

  return useCallback(() => {
    if (!upgradeUrl) return;
    try {
      // App Bridge navigation outside the app iframe
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (shopify as any)?.intents?.redirect?.(upgradeUrl) ||
        // Fallback
        window.open(upgradeUrl, "_top");
    } catch {
      window.open(upgradeUrl, "_top");
    }
  }, [shopify, upgradeUrl]);
}
