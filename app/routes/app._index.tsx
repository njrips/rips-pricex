import { TitleBar } from "@shopify/app-bridge-react";
import { useOutletContext } from "react-router";
import ClassicExperimentsList from "../components/SmartPricing/classic/ClassicExperimentsList";
import { useUpgradeRedirect } from "../lib/useUpgradeRedirect";
import type { AppOutletContext } from "../lib/api.client";
import "../styles/classic-theme.css";

export default function ExperimentsHome() {
  const ctx = useOutletContext<AppOutletContext>();
  const upgrade = useUpgradeRedirect(ctx.upgradeUrl);

  return (
    <>
      <TitleBar title="Experiments">
        {!ctx.entitled ? (
          <button variant="primary" onClick={upgrade}>
            Upgrade to create
          </button>
        ) : null}
      </TitleBar>
      {!ctx.entitled ? (
        <div style={{ padding: "12px 16px" }}>
          <s-banner tone="warning">
            Create is locked until this shop has an active Smart Pricing plan.{" "}
            <s-button onClick={upgrade}>Upgrade</s-button>
          </s-banner>
        </div>
      ) : null}
      <ClassicExperimentsList />
    </>
  );
}
