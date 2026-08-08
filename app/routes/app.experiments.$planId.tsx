import { TitleBar } from "@shopify/app-bridge-react";
import { Link } from "react-router";
import ClassicExperimentOverview from "../components/SmartPricing/classic/ClassicExperimentOverview";
import "../styles/classic-theme.css";

export default function ExperimentDetails() {
  return (
    <>
      <TitleBar title="Experiment">
        <Link to="/app">Experiments</Link>
      </TitleBar>
      <ClassicExperimentOverview />
    </>
  );
}
