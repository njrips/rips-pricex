import { isRouteErrorResponse, Link, Outlet, useLoaderData, useRouteError } from "react-router";

import { resolveAppStoreListingUrlFromEnv } from "../utils/appStoreListingUrl";
import PublicClassicShell from "../components/shared/PublicClassicShell";
import styles from "../components/public/publicStyles";

export const loader = async () => {
  return {
    storeUrl: resolveAppStoreListingUrlFromEnv(),
    supportEmail: String(process.env.RIPSPRICEX_SUPPORT_EMAIL || "").trim(),
  };
};

export type PublicOutletContext = {
  storeUrl: string;
  supportEmail: string;
};

export default function PublicLayout() {
  const data = useLoaderData<typeof loader>();

  return (
    <PublicClassicShell storeUrl={data.storeUrl}>
      <Outlet context={data} />
    </PublicClassicShell>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  const notFound = isRouteErrorResponse(error) && error.status === 404;

  return (
    <PublicClassicShell>
      <section className={styles.docCard}>
        <p className={styles.eyebrow}>RipsPriceX</p>
        <h1 className={`${styles.title} ripx-classic-sans`}>
          {notFound ? "Page not found" : "Something went wrong"}
        </h1>
        <p className={styles.subtitle}>
          {notFound
            ? "That public page does not exist. The product, Privacy, and FAQ are still here."
            : "The public site hit an error. Try the product page or install from the App Store."}
        </p>
        <Link to="/" className={styles.primaryBtn}>
          Back to RipsPriceX
        </Link>
      </section>
    </PublicClassicShell>
  );
}
