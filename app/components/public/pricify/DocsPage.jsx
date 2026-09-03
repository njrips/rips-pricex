import { useState } from 'react';
import { Link } from 'react-router';
import { DEFAULT_APP_STORE_LISTING_URL } from '../../../utils/appStoreListingUrl';
import { PUBLIC_ROUTES } from '../../../constants/publicRoutes';
import {
  DOCS_FAQ,
  DOCS_GROUPS,
  DOCS_HERO,
  DOCS_NAV_CARDS,
  DOCS_SECTIONS,
  DOCS_UPDATED,
} from './docsContent';

function InstallButton({ storeUrl, className, children }) {
  const href = storeUrl || DEFAULT_APP_STORE_LISTING_URL;
  return (
    <a className={className} href={href} target="_top" rel="noopener noreferrer">
      {children}
    </a>
  );
}

function DocsFaq() {
  const [open, setOpen] = useState(0);
  return (
    <div className="px-faq">
      {DOCS_FAQ.map((item, index) => {
        const expanded = open === index;
        return (
          <div key={item.q} className={expanded ? 'px-faq-item px-faq-item--open' : 'px-faq-item'}>
            <button
              type="button"
              className="px-faq-q"
              aria-expanded={expanded}
              aria-controls={`px-docs-faq-a-${index}`}
              id={`px-docs-faq-q-${index}`}
              onClick={() => setOpen(expanded ? -1 : index)}
            >
              <span>{item.q}</span>
              <span className={expanded ? 'px-faq-toggle px-faq-toggle--on' : 'px-faq-toggle'} aria-hidden>
                {expanded ? '−' : '+'}
              </span>
            </button>
            <p
              className="px-faq-a"
              id={`px-docs-faq-a-${index}`}
              role="region"
              aria-labelledby={`px-docs-faq-q-${index}`}
              hidden={!expanded}
            >
              {item.a}
            </p>
          </div>
        );
      })}
    </div>
  );
}

export default function DocsPage({ storeUrl }) {
  return (
    <div className="px-landing">
      <section className="px-section px-docs-hero">
        <p className="px-eyebrow px-eyebrow--plain">{DOCS_HERO.eyebrow}</p>
        <h1 className="px-docs-title">{DOCS_HERO.title}</h1>
        <p className="px-docs-lead">{DOCS_HERO.subtitle}</p>
        <p className="px-docs-updated">Updated {DOCS_UPDATED}</p>
      </section>

      <section className="px-section" id="guides">
        <div className="px-cards px-cards--2x2 px-docs-nav">
          {DOCS_NAV_CARDS.map((card) => (
            <a key={card.href} href={card.href} className="px-card px-docs-card">
              <p className="px-usecase-label">{card.label}</p>
              <h3>{card.title}</h3>
              <p>{card.body}</p>
            </a>
          ))}
        </div>
      </section>

      {DOCS_GROUPS.map((group) => (
        <section
          key={group.id}
          className={group.tone === 'deep' ? 'px-section px-section--deep' : 'px-section'}
          id={group.id}
        >
          <div className="px-section-head">
            <p className="px-eyebrow">{group.eyebrow}</p>
            <h2>{group.title}</h2>
          </div>
          <div className="px-docs-articles">
            {DOCS_SECTIONS.filter((section) => section.group === group.id).map((section) => (
              <article key={section.id} id={section.id} className="px-card">
                <h3>{section.title}</h3>
                {section.paragraphs.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
              </article>
            ))}
          </div>
        </section>
      ))}

      <section className="px-section" id="faq">
        <div className="px-section-head">
          <h2>Guides FAQ</h2>
        </div>
        <DocsFaq />
      </section>

      <section className="px-cta-wrap" id="cta">
        <div className="px-cta">
          <h2>Ready to test your prices?</h2>
          <p>Install Pricify and start running pricing experiments on your Shopify store for free.</p>
          <InstallButton storeUrl={storeUrl} className="px-btn px-btn--brand px-btn--lg">
            Install free on Shopify
          </InstallButton>
          <p className="px-cta-fine">
            <Link to={PUBLIC_ROUTES.home}>Back to Pricify</Link>
            {' · '}
            <Link to={PUBLIC_ROUTES.contact}>Contact</Link>
          </p>
        </div>
      </section>
    </div>
  );
}
