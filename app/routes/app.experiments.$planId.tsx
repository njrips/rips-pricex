import { TitleBar } from "@shopify/app-bridge-react";
import { useNavigate } from "react-router";
import ClassicExperimentOverview from "../components/SmartPricing/classic/ClassicExperimentOverview";
import "../styles/classic-theme.css";

export default function ExperimentDetails() {
  const navigate = useNavigate();
  return (
    <>
      <TitleBar title="Test">
        <button type="button" variant="breadcrumb" onClick={() => navigate("/app")}>
          Tests
        </button>
      </TitleBar>
      <ClassicExperimentOverview />
    </>
  );
}
