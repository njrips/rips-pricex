import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { DEFAULT_APP_STORE_LISTING_URL } from '../../../utils/appStoreListingUrl';
import { PUBLIC_ROUTES } from '../../../constants/publicRoutes';
import useKeyedState from '../../../hooks/useKeyedState';
import { parsePublicSectionId } from './scrollToPublicHash';
import {
  DOCS_FAQ,
  DOCS_GROUPS,
  DOCS_HERO,
  DOCS_NAV_CARDS,
  DOCS_SECTIONS,
  DOCS_UPDATED,
} from './docsContent';

/**
 * The section id in the URL fragment, tracked so a deep link can open the
 * section it points at. Starts empty and fills in after mount: the server has
 * no fragment to render, so reading it during render would not match.
 */
function useTargetedSectionId() {
  const [id, setId] = useState('');
  useEffect(() => {
    const read = () => setId(parsePublicSectionId(window.location.hash));
    read();
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, []);
  return id;
}

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

/**
 * A guide article. Long sections carry a `summary` and a `facts` strip so the
 * page can be skimmed, with the full prose folded away behind a disclosure —
 * `confidence` and `min-sample` run past 3,500 characters each, which nobody
 * reads to answer "what does this setting do again?".
 *
 * Short sections have no summary and render as a plain card: a one-paragraph
 * article is already its own summary, and splitting it would just add a click.
 */
function DocsArticle({ section, targeted }) {
  // Keyed on `targeted` so arriving from a Settings info icon — which links to
  // /docs#confidence expressly to read the detail — opens the section, while a
  // later manual collapse still sticks until the hash changes again.
  const [open, setOpen] = useKeyedState(targeted, targeted);
  const facts = Array.isArray(section.facts) ? section.facts : [];

  if (!section.summary) {
    return (
      <article id={section.id} className="px-card">
        <h3>{section.title}</h3>
        {section.paragraphs.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
      </article>
    );
  }

  return (
    <article id={section.id} className="px-card px-docs-article">
      <h3>{section.title}</h3>
      <p className="px-docs-summary">{section.summary}</p>
      {facts.length ? (
        <dl className="px-docs-facts">
          {facts.map((fact) => (
            <div key={fact.label} className="px-docs-fact">
              <dt>{fact.label}</dt>
              <dd>{fact.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      <button
        type="button"
        className="px-docs-more"
        aria-expanded={open}
        aria-controls={`px-docs-detail-${section.id}`}
        onClick={() => setOpen((prev) => !prev)}
      >
        <span>{open ? 'Hide full explanation' : 'Read the full explanation'}</span>
        <span className={open ? 'px-faq-toggle px-faq-toggle--on' : 'px-faq-toggle'} aria-hidden>
          {open ? '−' : '+'}
        </span>
      </button>
      <div className="px-docs-detail" id={`px-docs-detail-${section.id}`} hidden={!open}>
        {section.paragraphs.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
      </div>
    </article>
  );
}

export default function DocsPage({ storeUrl }) {
  const targetedId = useTargetedSectionId();
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
              <DocsArticle
                key={section.id}
                section={section}
                targeted={targetedId === section.id}
              />
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
          <p>Install Priceify and start running pricing experiments on your Shopify store for free.</p>
          <InstallButton storeUrl={storeUrl} className="px-btn px-btn--brand px-btn--lg">
            Install free on Shopify
          </InstallButton>
          <p className="px-cta-fine">
            <Link to={PUBLIC_ROUTES.home}>Back to Priceify</Link>
            {' · '}
            <Link to={PUBLIC_ROUTES.contact}>Contact</Link>
          </p>
        </div>
      </section>
    </div>
  );
}
