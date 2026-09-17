import { useState } from 'react';
import { Link } from 'react-router';
import { PUBLIC_ROUTES } from '../../../constants/publicRoutes';
import {
  buildFaqJsonLd,
  FAQ_ITEMS,
  FAQ_SECTION,
  FEATURES_SECTION,
  FINAL_CTA,
  GET_STARTED_SECTION,
  HERO,
  LANDING_ASSETS,
  LOGO_CLOUD,
  PLATFORM_SECTION,
  PRICE_TEST_DEMO,
  PRICING_SECTION,
} from './landingContent';
import LogoMarquee from './LogoMarquee';
import { LANDING_BILLING, quoteTierPrice } from './landingPricing';
import {
  BrochureFaqAccordion,
  HeroCtas,
  InstallButton,
  SectionIntro,
} from './brochurePublicUi';

function FeatureBoard({ items }) {
  const rows = [items.slice(0, 3), items.slice(3, 6)];
  return (
    <div className="px-feature-board">
      {rows.map((row, rowIndex) => (
        <div key={row.map(item => item.title).join('-')} className="px-feature-board-row">
          {rowIndex > 0 ? <div className="px-feature-board-rule" aria-hidden /> : null}
          <div className="px-feature-board-cells">
            {row.map((item, cellIndex) => (
              <div key={item.title} className="px-feature-board-cell-wrap">
                {cellIndex > 0 ? <div className="px-feature-board-vrule" aria-hidden /> : null}
                <article className="px-feature-board-cell">
                  <div className="px-feature-icon-wrap">
                    <img src={item.iconSrc} alt="" width={40} height={40} />
                  </div>
                  <h3>{item.title}</h3>
                  <p>{item.body}</p>
                </article>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function PricingPlans({ storeUrl }) {
  const [billing, setBilling] = useState(LANDING_BILLING.annual);
  const isAnnual = billing === LANDING_BILLING.annual;

  return (
    <>
      <div className="px-billing-toggle" role="group" aria-label="Billing period">
        <div className="px-billing-segments">
          <button
            type="button"
            className={
              !isAnnual ? 'px-billing-seg px-billing-seg--active' : 'px-billing-seg'
            }
            aria-pressed={!isAnnual}
            onClick={() => setBilling(LANDING_BILLING.monthly)}
          >
            Monthly
          </button>
          <button
            type="button"
            className={isAnnual ? 'px-billing-seg px-billing-seg--active' : 'px-billing-seg'}
            aria-pressed={isAnnual}
            onClick={() => setBilling(LANDING_BILLING.annual)}
          >
            Annual
          </button>
        </div>
        {isAnnual ? <span className="px-billing-save">{PRICING_SECTION.saveBadge}</span> : null}
      </div>
      <div className="px-pricing-grid">
        {PRICING_SECTION.tiers.map(tier => {
          const quote = quoteTierPrice(tier, billing);
          return (
            <article
              key={tier.id}
              className={tier.featured ? 'px-plan px-plan--featured' : 'px-plan'}
            >
              <div className="px-plan-top">
                <div className="px-plan-head">
                  <h3>{tier.name}</h3>
                  {tier.badge ? <span className="px-plan-badge">{tier.badge}</span> : null}
                </div>
                <p className="px-plan-price">
                  <strong>{quote.price}</strong>
                  <span className="px-plan-period">{quote.period}</span>
                </p>
                <p
                  className={
                    tier.ordersHighlight
                      ? 'px-plan-orders px-plan-orders--highlight'
                      : 'px-plan-orders'
                  }
                >
                  {tier.orders}
                </p>
                <p className="px-plan-blurb">{tier.blurb}</p>
                <InstallButton
                  storeUrl={storeUrl}
                  className={
                    tier.featured
                      ? 'px-btn px-btn--dark px-btn--plan'
                      : 'px-btn px-btn--plan-outline'
                  }
                >
                  {tier.cta}
                </InstallButton>
              </div>
              <ul className="px-plan-features">
                {tier.features.map(line => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </article>
          );
        })}
      </div>
      <Link to={PUBLIC_ROUTES.contact} className="px-pricing-see-all">
        {PRICING_SECTION.seeAllPlansLabel}
        <img src={LANDING_ASSETS.chevronRightDark} alt="" width={20} height={20} aria-hidden />
      </Link>
    </>
  );
}

export default function LandingPage({ storeUrl }) {
  return (
    <div className="px-landing px-landing--v2">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(buildFaqJsonLd()).replace(/</g, '\\u003c'),
        }}
      />

      <section className="px-hero px-hero--stack">
        <div className="px-hero-inner">
          <p className="px-badge px-badge--pill">
            <img className="px-badge-flare" src={LANDING_ASSETS.flare} alt="" width={20} height={20} />
            {HERO.badge}
          </p>
          <h1>{HERO.title}</h1>
          <p className="px-lead px-lead--center">{HERO.lead}</p>
          <HeroCtas storeUrl={storeUrl} />
        </div>
        <div className="px-hero-shot-wrap">
          <img
            className="px-hero-shot"
            src={LANDING_ASSETS.heroDashboard}
            alt="Priceify tests dashboard showing running tests and workspace metrics"
            width={1200}
            height={686}
            loading="eager"
            decoding="async"
          />
        </div>
      </section>

      <section className="px-logo-cloud" aria-label={LOGO_CLOUD.title}>
        <p className="px-logo-cloud-label">{LOGO_CLOUD.title}</p>
        <LogoMarquee />
      </section>

      <section className="px-section px-section--soft" id="how-it-works">
        <SectionIntro title={PRICE_TEST_DEMO.title} lead={PRICE_TEST_DEMO.lead} />
        <div className="px-shot-frame">
          <img
            className="px-shot"
            src={LANDING_ASSETS.priceTestDemo}
            alt="Side-by-side control and variation product cards with a winning variation banner"
            width={1200}
            height={757}
            loading="lazy"
            decoding="async"
          />
        </div>
      </section>

      <section className="px-section" id="platform">
        <SectionIntro title={PLATFORM_SECTION.title} lead={PLATFORM_SECTION.lead} />
        <div className="px-shot-frame">
          <img
            className="px-shot"
            src={LANDING_ASSETS.platformWalkthrough}
            alt="Four-step overview of choosing products, splitting traffic, setting prices, and measuring results"
            width={1200}
            height={1063}
            loading="lazy"
            decoding="async"
          />
        </div>
      </section>

      <section className="px-section px-section--features" id="features">
        <SectionIntro title={FEATURES_SECTION.title} lead={FEATURES_SECTION.lead} />
        <FeatureBoard items={FEATURES_SECTION.items} />
      </section>

      <section className="px-section px-section--pricing-brochure" id="pricing">
        <SectionIntro title={PRICING_SECTION.title} lead={PRICING_SECTION.lead} />
        <PricingPlans storeUrl={storeUrl} />
      </section>

      <section className="px-section px-section--soft" id="faq">
        <SectionIntro title={FAQ_SECTION.title} lead={FAQ_SECTION.subtitle} />
        <BrochureFaqAccordion items={FAQ_ITEMS} />
      </section>

      <section className="px-section px-get-started px-get-started--brochure">
        <div className="px-get-started-inner">
          <SectionIntro title={GET_STARTED_SECTION.title} lead={GET_STARTED_SECTION.lead} />
          <div className="px-get-started-grid">
            {GET_STARTED_SECTION.cards.map(card => (
              <Link key={card.title} to={card.to} className="px-get-started-card">
                <div className="px-get-started-card-copy">
                  <h3>{card.title}</h3>
                  <p>{card.body}</p>
                </div>
                <span className="px-get-started-arrow" aria-hidden>
                  <img src={LANDING_ASSETS.arrowForward} alt="" width={24} height={24} />
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="px-final-cta px-final-cta--brochure" id="cta">
        <div className="px-final-cta-bg" aria-hidden />
        <div className="px-final-cta-content">
          <h2>
            {FINAL_CTA.titleLine1}
            <br />
            {FINAL_CTA.titleLine2}
          </h2>
          <p className="px-lead px-lead--center">{FINAL_CTA.lead}</p>
          <HeroCtas storeUrl={storeUrl} />
          <p className="px-final-fine">{FINAL_CTA.fine}</p>
        </div>
      </section>
    </div>
  );
}
