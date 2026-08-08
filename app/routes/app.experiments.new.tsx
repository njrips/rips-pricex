import { TitleBar } from "@shopify/app-bridge-react";
import { useNavigate, useOutletContext } from "react-router";
import ClassicCreateWizard from "../components/SmartPricing/classic/ClassicCreateWizard";
import { useUpgradeRedirect } from "../lib/useUpgradeRedirect";
import type { AppOutletContext } from "../lib/api.client";
import "../styles/classic-theme.css";

export default function CreateExperiment() {
  const ctx = useOutletContext<AppOutletContext>();
  const upgrade = useUpgradeRedirect(ctx.upgradeUrl);
  const navigate = useNavigate();

  if (!ctx.entitled) {
    return (
      <>
        <TitleBar title="Create experiment" />
        <div style={{ padding: 24 }}>
          <s-banner tone="warning">
            Creating Smart Pricing experiments requires an active plan.
          </s-banner>
          <div style={{ marginTop: 16 }}>
            <s-button variant="primary" onClick={upgrade}>
              Upgrade / choose plan
            </s-button>
            <s-button onClick={() => navigate("/app")}>Back to experiments</s-button>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <TitleBar title="New experiment" />
      <ClassicCreateWizard />
    </>
  );
}
