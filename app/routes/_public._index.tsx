import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useOutletContext } from "react-router";

import { publicMeta } from "../components/public/publicMeta";
import LandingPage from "../components/public/priceify/LandingPage";
import { authenticate } from "../shopify.server";
import type { PublicOutletContext } from "./_public";

export const meta: MetaFunction = () =>
  publicMeta({
    title: "Priceify — Test Shopify prices before changing them for everyone",
    description:
      "Launch Shopify price experiments in minutes. Split live traffic, measure revenue per visitor, and stop losing variations automatically with built-in guardrails.",
    path: "/",
  });

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  if (
    url.searchParams.get("shop") ||
    url.searchParams.get("host") ||
    url.searchParams.get("embedded")
  ) {
    // Finish the session on `/` (Admin iframe src) first. A bare 302 to /app
    // before auth makes App Bridge retry `/` forever. After auth, use Shopify's
    // redirect so bounce/data requests keep embed params.
    const { redirect: appRedirect } = await authenticate.admin(request);
    throw appRedirect("/app");
  }
  return null;
};

export default function PublicHome() {
  const { storeUrl } = useOutletContext<PublicOutletContext>();
  return <LandingPage storeUrl={storeUrl} />;
}
