import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";
import { Link, useLoaderData } from "react-router";

import { login } from "../../shopify.server";
import { loginErrorMessage } from "./error.server";
import { runShopLogin } from "../../utils/shopifyShopLogin.server";
import { resolveAppStoreListingUrlFromEnv } from "../../utils/appStoreListingUrl";
import PublicClassicShell from "../../components/shared/PublicClassicShell";
import styles from "../../components/public/publicStyles";
import PublicShopOpenForm from "../../components/shared/PublicShopOpenForm";
import { IconArrowLeft } from "../../components/SmartPricing/classic/classicIcons";
import { publicMeta } from "../../components/public/publicMeta";

export const meta: MetaFunction = () =>
  publicMeta({
    title: "Open in Admin",
    description: "CLI and returning-merchant shop handle. App Store install does not use this page.",
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
    <PublicClassicShell narrow storeUrl={storeUrl}>
      <section className={styles.hero}>
        <Link to="/" className={styles.backLink}>
          <IconArrowLeft /> Back to RipsPriceX
        </Link>
        <p className={styles.eyebrow}>Smart Pricing</p>
        <h1 className={`${styles.title} ripx-classic-sans`}>Open in Shopify Admin</h1>
        <p className={styles.subtitle}>
          Enter your shop handle. Shopify install links already include your shop
          and skip this step.
        </p>
        <PublicShopOpenForm
          action="/auth/login"
          autoFocus
          initialError={loaderShopError}
          title="Shop handle"
        />
      </section>
    </PublicClassicShell>
  );
}
