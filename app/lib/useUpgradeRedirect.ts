import { useAdminExternalRedirect } from "./useAdminExternalRedirect";

/**
 * Redirect merchant to Shopify App Pricing plan selection (breaks out of iframe).
 */
export function useUpgradeRedirect(upgradeUrl: string) {
  return useAdminExternalRedirect(upgradeUrl);
}
