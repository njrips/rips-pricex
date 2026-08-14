import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { redirect, useOutletContext } from "react-router";

import { publicMeta } from "../components/public/publicMeta";
import LandingPage from "../components/public/landing/LandingPage";
import type { PublicOutletContext } from "./_public";

export const meta: MetaFunction = () =>
  publicMeta({
    title: "RipsPriceX — Classic Smart Pricing",
    description:
      "Test catalog prices on your Shopify storefront and keep the winner. Classic Smart Pricing — experiments, theme mapping, and checkout-ready launch.",
    path: "/",
  });

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }
  return null;
};

export default function PublicHome() {
  const { storeUrl } = useOutletContext<PublicOutletContext>();
  return <LandingPage storeUrl={storeUrl} />;
}
