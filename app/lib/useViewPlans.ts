import { useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { withCurrentEmbeddedSearch } from "../utils/shopifyEmbeddedSearch";

/**
 * "View plans" opens App settings → Plan & usage rather than Shopify's plan page
 * directly: that page is a "page not found" until App Pricing plans exist, and
 * the Plan tab knows whether they do and says what to do either way.
 */
export function useViewPlans() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  return useCallback(() => {
    navigate(withCurrentEmbeddedSearch(searchParams, "/app/settings", { tab: "plan" }));
  }, [navigate, searchParams]);
}
