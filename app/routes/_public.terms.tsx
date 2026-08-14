import type { MetaFunction } from "react-router";

import { publicMeta } from "../components/public/publicMeta";
import PublicDocPage from "../components/public/legal/PublicDocPage";
import {
  TERMS_INTRO,
  TERMS_SECTIONS,
  TERMS_UPDATED,
} from "../components/public/legal/termsContent";

export const meta: MetaFunction = () =>
  publicMeta({
    title: "Terms",
    description:
      "How merchants use RipsPriceX on Shopify — install, App Pricing, Setup, and applying a winner.",
    path: "/terms",
  });

export default function TermsRoute() {
  return (
    <PublicDocPage
      eyebrow="Legal"
      title="Terms"
      updated={TERMS_UPDATED}
      intro={TERMS_INTRO}
      sections={TERMS_SECTIONS}
    />
  );
}
