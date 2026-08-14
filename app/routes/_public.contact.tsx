import type { MetaFunction } from "react-router";
import { useOutletContext } from "react-router";

import { publicMeta } from "../components/public/publicMeta";
import ContactPage from "../components/public/contact/ContactPage";
import type { PublicOutletContext } from "./_public";

export const meta: MetaFunction = () =>
  publicMeta({
    title: "Contact",
    description:
      "Install RipsPriceX from the Shopify App Store or read FAQ and Privacy.",
    path: "/contact",
  });

export default function ContactRoute() {
  const { storeUrl, supportEmail } = useOutletContext<PublicOutletContext>();
  return <ContactPage storeUrl={storeUrl} supportEmail={supportEmail} />;
}
