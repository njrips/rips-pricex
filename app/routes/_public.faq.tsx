import type { MetaFunction } from "react-router";
import { redirect } from "react-router";

import { publicMeta } from "../components/public/publicMeta";

export const meta: MetaFunction = () =>
  publicMeta({
    title: "FAQ",
    description: "Frequently asked questions about Priceify pricing experiments on Shopify.",
    path: "/faq",
  });

export const loader = async () => {
  throw redirect("/#faq");
};

export default function FaqRoute() {
  return null;
}
