import { useOutletContext } from "react-router";
import { TitleBar } from "@shopify/app-bridge-react";
import type { AppOutletContext } from "../lib/api.client";
import { useUpgradeRedirect } from "../lib/useUpgradeRedirect";

export default function BillingPage() {
  const ctx = useOutletContext<AppOutletContext>();
  const upgrade = useUpgradeRedirect(ctx.upgradeUrl);

  return (
    <s-page heading="Billing">
      <TitleBar title="Billing">
        <button variant="primary" onClick={upgrade}>
          {ctx.entitled ? "Manage plan" : "Upgrade"}
        </button>
      </TitleBar>

      <s-section>
        <s-stack direction="block" gap="base">
          <s-text>
            Status: <strong>{ctx.entitled ? "Entitled" : "Locked"}</strong>
          </s-text>
          <s-text>Plan: {ctx.planHandle || "none"}</s-text>
          <s-text>Shop: {ctx.shop}</s-text>
          <s-paragraph>
            Subscriptions are managed by Shopify App Pricing. Create and Launch stay locked
            until this shop has an active plan.
          </s-paragraph>
          <s-button variant="primary" onClick={upgrade}>
            Open Shopify plan selection
          </s-button>
        </s-stack>
      </s-section>
    </s-page>
  );
}
