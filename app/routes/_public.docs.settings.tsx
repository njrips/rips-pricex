import type { MetaFunction } from "react-router";
import { redirect } from "react-router";

import { publicMeta } from "../components/public/publicMeta";

export const meta: MetaFunction = () =>
  publicMeta({
    title: "Guides",
    description:
      "How Pricify Settings apply to new experiments: confidence, sample size, and price safety.",
    path: "/docs/settings",
  });

export const loader = async () => {
  throw redirect("/docs#how-settings-work");
};

export default function DocsSettingsRedirect() {
  return null;
}
