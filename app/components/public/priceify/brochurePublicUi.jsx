import { useState } from 'react';
import { DEFAULT_APP_STORE_LISTING_URL } from '../../../utils/appStoreListingUrl';
import { HERO, LANDING_ASSETS } from './landingContent';

export function InstallButton({ storeUrl, className, children }) {
  const href = storeUrl || DEFAULT_APP_STORE_LISTING_URL;
  return (
    <a className={className} href={href} target="_top" rel="noopener noreferrer">
      {children}
    </a>
  );
}

export function ShopifyCtaButton({ storeUrl, className, children }) {
  return (
    <InstallButton storeUrl={storeUrl} className={className}>
      <img className="px-shopify-mark" src={LANDING_ASSETS.shopifyBag} alt="" width={24} height={24} />
      {children}
    </InstallButton>
  );
}

export function HeroCtas({ storeUrl, className = 'px-hero-ctas' }) {
  return (
    <div className={className}>
      <ShopifyCtaButton storeUrl={storeUrl} className="px-btn px-btn--dark px-btn--lg">
        {HERO.primaryCta}
      </ShopifyCtaButton>
      <InstallButton storeUrl={storeUrl} className="px-btn px-btn--ghost px-btn--lg">
        {HERO.secondaryCta}
      </InstallButton>
    </div>
  );
}

export function SectionIntro({ title, lead, id, eyebrow }) {
  return (
    <div className="px-section-head px-section-head--center" id={id}>
      {eyebrow ? <p className="px-guides-group-eyebrow">{eyebrow}</p> : null}
      <h2>{title}</h2>
      {lead ? <p>{lead}</p> : null}
    </div>
  );
}

/** Card-style FAQ accordion used on landing and guides. */
export function BrochureFaqAccordion({ items, idPrefix = 'px-faq' }) {
  const [open, setOpen] = useState(0);

  return (
    <div className="px-faq px-faq--cards">
      {items.map((item, index) => {
        const expanded = open === index;
        const qId = `${idPrefix}-q-${index}`;
        const aId = `${idPrefix}-a-${index}`;
        return (
          <article
            key={item.q}
            className={expanded ? 'px-faq-card px-faq-card--open' : 'px-faq-card'}
          >
            <button
              type="button"
              className="px-faq-card-q"
              aria-expanded={expanded}
              aria-controls={aId}
              id={qId}
              onClick={() => setOpen(expanded ? -1 : index)}
            >
              <span>{item.q}</span>
              <img
                className={expanded ? 'px-faq-chevron px-faq-chevron--open' : 'px-faq-chevron'}
                src={LANDING_ASSETS.chevronDown}
                alt=""
                width={20}
                height={20}
                aria-hidden
              />
            </button>
            {expanded ? (
              <div className="px-faq-card-a" id={aId} role="region" aria-labelledby={qId}>
                {item.a}
              </div>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}
