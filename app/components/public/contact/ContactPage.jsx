import { Link } from 'react-router';
import { IconArrowUpRight } from '../../SmartPricing/classic/classicIcons';
import { PUBLIC_ROUTES } from '../../../constants/publicRoutes';
import styles from '../publicStyles';

export default function ContactPage({ storeUrl, supportEmail = '' }) {
  return (
    <section className={styles.docCard}>
      <p className={styles.eyebrow}>Support</p>
      <h1 className={`${styles.title} ripx-classic-sans`}>Contact</h1>
      <p className={styles.subtitle}>
        RipsPriceX lives in Shopify Admin. For install, use the App Store. For
        product questions, start with FAQ.
      </p>

      <div className={styles.contactGrid}>
        <div className={styles.contactCard}>
          <p className={styles.panelTitle}>Install or open the app</p>
          <p className={styles.docBody}>
            Shopify collects your shop on the listing. This site never asks for a
            domain or password.
          </p>
          <a
            className={styles.primaryBtn}
            href={storeUrl}
            target="_top"
            rel="noopener noreferrer"
          >
            Install on Shopify
            <IconArrowUpRight />
          </a>
        </div>

        <div className={styles.contactCard}>
          <p className={styles.panelTitle}>Product questions</p>
          <p className={styles.docBody}>
            Setup, price surfaces, billing, and applying a winner are covered on
            FAQ in the same terms as the in-app checklist.
          </p>
          <Link to={PUBLIC_ROUTES.faq} className={styles.textLink}>
            Read the FAQ
          </Link>
        </div>

        <div className={styles.contactCard}>
          <p className={styles.panelTitle}>Privacy and data</p>
          <p className={styles.docBody}>
            How we use Shopify APIs, storefront assignment, and uninstall is on
            the Privacy page — the URL you can paste into the App Store listing.
          </p>
          <Link to={PUBLIC_ROUTES.privacy} className={styles.textLink}>
            Read Privacy
          </Link>
        </div>

        {supportEmail ? (
          <div className={styles.contactCard}>
            <p className={styles.panelTitle}>Email</p>
            <p className={styles.docBody}>
              For listing or data requests that are not answered in FAQ.
            </p>
            <a className={styles.textLink} href={`mailto:${supportEmail}`}>
              {supportEmail}
            </a>
          </div>
        ) : null}
      </div>
    </section>
  );
}
