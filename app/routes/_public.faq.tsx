import type { MetaFunction } from "react-router";

import { publicMeta } from "../components/public/publicMeta";
import FaqPage from "../components/public/faq/FaqPage";

export const meta: MetaFunction = () =>
  publicMeta({
    title: "FAQ",
    description:
      "Install, Setup, price surfaces, billing, and applying a winner in RipsPriceX.",
    path: "/faq",
  });

export default function FaqRoute() {
  return <FaqPage />;
}
