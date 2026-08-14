import type { MetaFunction } from "react-router";

import { publicMeta } from "../components/public/publicMeta";
import PublicDocPage from "../components/public/legal/PublicDocPage";
import {
  PRIVACY_INTRO,
  PRIVACY_SECTIONS,
  PRIVACY_UPDATED,
} from "../components/public/legal/privacyContent";

export const meta: MetaFunction = () =>
  publicMeta({
    title: "Privacy",
    description:
      "How RipsPriceX uses Shopify APIs, shop settings, and storefront assignment data. App Store listing privacy URL.",
    path: "/privacy",
  });

export default function PrivacyRoute() {
  return (
    <PublicDocPage
      eyebrow="Legal"
      title="Privacy"
      updated={PRIVACY_UPDATED}
      intro={PRIVACY_INTRO}
      sections={PRIVACY_SECTIONS}
    />
  );
}
