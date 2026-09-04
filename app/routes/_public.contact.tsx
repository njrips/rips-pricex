import type { MetaFunction } from "react-router";
import { useOutletContext } from "react-router";

import { publicMeta } from "../components/public/publicMeta";
import ContactPage from "../components/public/priceify/ContactPage";
import type { PublicOutletContext } from "./_public";

export const meta: MetaFunction = () =>
  publicMeta({
    title: "Contact",
    description: "Reach Priceify or install from the Shopify App Store.",
    path: "/contact",
  });

export default function ContactRoute() {
  const { storeUrl, supportEmail } = useOutletContext<PublicOutletContext>();
  return <ContactPage storeUrl={storeUrl} supportEmail={supportEmail} />;
}
