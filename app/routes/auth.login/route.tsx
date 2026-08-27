import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";
import { Link, useLoaderData } from "react-router";

import { login } from "../../shopify.server";
import { loginErrorMessage } from "./error.server";
import { runShopLogin } from "../../utils/shopifyShopLogin.server";
import { resolveAppStoreListingUrlFromEnv } from "../../utils/appStoreListingUrl";
import PricifyShell from "../../components/public/pricify/PricifyShell";
import styles from "../../components/public/publicStyles";
import PublicShopOpenForm from "../../components/shared/PublicShopOpenForm";
import { IconArrowLeft } from "../../components/SmartPricing/classic/classicIcons";
import { publicMeta } from "../../components/public/publicMeta";
import { PUBLIC_ROUTES } from "../../constants/publicRoutes";

export const meta: MetaFunction = () =>
  publicMeta({
    title: "Shop handle",
    description: "CLI shop-handle utility. Merchants install from the App Store. Operators use Staff for tickets.",
    path: "/auth/login",
    noIndex: true,
  });

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const errors = loginErrorMessage(await login(request));
  return { errors, storeUrl: resolveAppStoreListingUrlFromEnv() };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  return runShopLogin(request);
};

export default function Auth() {
  const { errors, storeUrl } = useLoaderData<typeof loader>();
  const loaderShopError = errors?.shop || "";

  return (
    <PricifyShell storeUrl={storeUrl}>
      <section className={styles.hero}>
        <Link to="/" className={styles.backLink}>
          <IconArrowLeft /> Back to Pricify
        </Link>
        <p className={styles.eyebrow}>CLI</p>
        <h1 className={styles.title}>Shop handle</h1>
        <p className={styles.subtitle}>
          Merchants install from the App Store — this form is only for Shopify CLI
          and shop-handle OAuth. Operators reviewing tickets use Staff, not this page.
        </p>
        <PublicShopOpenForm
          action="/auth/login"
          autoFocus
          initialError={loaderShopError}
          title="Shop handle"
        />
        <p className={styles.subtitle} style={{ marginTop: 24 }}>
          <Link to={PUBLIC_ROUTES.staff} className="textLink" reloadDocument>
            Staff ticket queue
          </Link>
        </p>
      </section>
    </PricifyShell>
  );
}
