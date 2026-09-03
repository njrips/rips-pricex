import type { MetaFunction } from "react-router";
import { useOutletContext } from "react-router";

import { publicMeta } from "../components/public/publicMeta";
import DocsPage from "../components/public/pricify/DocsPage";
import type { PublicOutletContext } from "./_public";

export const meta: MetaFunction = () =>
  publicMeta({
    title: "Guides",
    description:
      "How Pricify guardrails, confidence, sample size, and sequential testing work. The guide behind Settings info icons.",
    path: "/docs",
  });

export default function DocsRoute() {
  const { storeUrl } = useOutletContext<PublicOutletContext>();
  return <DocsPage storeUrl={storeUrl} />;
}
