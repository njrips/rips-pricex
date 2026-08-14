import {
  IconArrowUpRight,
  IconCheck,
  IconFlask,
  IconShield,
  IconWand,
} from '../../SmartPricing/classic/classicIcons';
import styles from '../publicStyles';
import {
  LANDING_BENEFITS,
  LANDING_FEATURES,
  LANDING_PREVIEW_ROWS,
  LANDING_STEPS,
} from './landingContent';

const FEATURE_ICONS = {
  experiments: IconFlask,
  surfaces: IconWand,
  setup: IconShield,
};

export default function LandingPage({ storeUrl }) {
  return (
    <>
      <section className={styles.hero}>
        <p className={styles.eyebrow}>Smart Pricing</p>
        <h1 className={`${styles.title} ripx-classic-sans`}>
          Test catalog prices. Keep the winner.
        </h1>
        <p className={styles.subtitle}>
          Classic Smart Pricing for Shopify. Run price experiments on your
          storefront, then apply the winner when the result is ready.
        </p>

        <div className={styles.showcase}>
          <div className={styles.showcaseCopy}>
            <p className={styles.panelTitle}>What RipsPriceX does</p>
            <p className={styles.showcaseLead}>
              Merchants stay in Shopify Admin. Visitors see mapped test prices.
              You decide when a variation becomes the catalog price.
            </p>
            <ul className={styles.benefitList}>
              {LANDING_BENEFITS.map((line) => (
                <li key={line} className={styles.benefitItem}>
                  <span className={styles.benefitIcon} aria-hidden>
                    <IconCheck size={12} />
                  </span>
                  <span>{line}</span>
                </li>
              ))}
            </ul>
            <div className={styles.showcaseActions}>
              <a
                className={styles.primaryBtn}
                href={storeUrl}
                target="_top"
                rel="noopener noreferrer"
              >
                Install on Shopify
                <IconArrowUpRight />
              </a>
              <p className={styles.help}>
                Opens the Shopify App Store listing. Shopify collects the shop —
                this page never asks for a domain or password.
              </p>
            </div>
          </div>

          <aside className={styles.previewCard} aria-hidden>
            <div className={styles.previewTop}>
              <p className={styles.previewEyebrow}>Workspace</p>
              <span className={styles.pill}>Experiments</span>
            </div>
            <p className={styles.previewTitle}>Price tests in Admin</p>
            {LANDING_PREVIEW_ROWS.map((row) => (
              <div key={row.name} className={styles.previewRow}>
                <div>
                  <p className={styles.previewName}>{row.name}</p>
                  <p className={styles.previewMeta}>{row.meta}</p>
                </div>
                <p className={styles.previewPrice}>{row.price}</p>
              </div>
            ))}
          </aside>
        </div>
      </section>

      <ul className={styles.features}>
        {LANDING_FEATURES.map((feature) => {
          const Icon = FEATURE_ICONS[feature.id] || IconFlask;
          return (
            <li key={feature.id} className={styles.feature}>
              <div className={styles.featureTop}>
                <span className={styles.featureIcon} aria-hidden>
                  <Icon />
                </span>
                <p className={styles.featureLabel}>{feature.label}</p>
              </div>
              <h2 className={styles.featureTitle}>{feature.title}</h2>
              <p className={styles.featureBody}>{feature.body}</p>
            </li>
          );
        })}
      </ul>

      <section className={styles.stepsCard} aria-labelledby="landing-steps-title">
        <div className={styles.stepsHead}>
          <p className={styles.eyebrow}>How it works</p>
          <h2 id="landing-steps-title" className={`${styles.panelTitle} ripx-classic-sans`}>
            Same path as inside the app
          </h2>
        </div>
        <div className={styles.steps} role="list">
          {LANDING_STEPS.map((step, index) => (
            <div key={step.label} className={styles.stepWrap}>
              {index > 0 ? <span className={styles.stepConnector} aria-hidden /> : null}
              <div className={styles.step} role="listitem">
                <span className={styles.stepDot} aria-hidden>
                  {index === LANDING_STEPS.length - 1 ? <IconCheck size={14} /> : index + 1}
                </span>
                <div className={styles.stepCopy}>
                  <p className={styles.stepLabel}>{step.label}</p>
                  <p className={styles.stepSub}>{step.sub}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
