import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { PUBLIC_ROUTES } from '../../../constants/publicRoutes';
import useKeyedState from '../../../hooks/useKeyedState';
import { parsePublicSectionId } from './scrollToPublicHash';
import { buildFaqJsonLd, HERO, LANDING_ASSETS } from './landingContent';
import {
  BrochureFaqAccordion,
  SectionIntro,
  ShopifyCtaButton,
} from './brochurePublicUi';
import {
  DOCS_FAQ,
  DOCS_FAQ_SECTION,
  DOCS_FINAL_CTA,
  DOCS_GROUPS,
  DOCS_HERO,
  DOCS_NAV_CARDS,
  DOCS_NAV_SECTION,
  DOCS_SECTIONS,
  DOCS_UPDATED,
} from './docsContent';
import { scheduleScrollToPublicHash } from './scrollToPublicHash';

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

/** Retry scroll after a deep-linked disclosure opens — layout height shifts. */
function useScrollToTargetedSection(targetedId) {
  useEffect(() => {
    if (!targetedId) return;
    scheduleScrollToPublicHash(`#${targetedId}`);
  }, [targetedId]);
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
      <article id={section.id} className="px-card px-docs-article-card">
        <h3>{section.title}</h3>
        {section.paragraphs.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
      </article>
    );
  }

  return (
    <article id={section.id} className="px-card px-docs-article px-docs-article-card">
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
        <img
          className={open ? 'px-faq-chevron px-faq-chevron--open' : 'px-faq-chevron'}
          src={LANDING_ASSETS.chevronDown}
          alt=""
          width={20}
          height={20}
          aria-hidden
        />
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
  useScrollToTargetedSection(targetedId);
  return (
    <div className="px-landing px-landing--v2 px-guides-page">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(buildFaqJsonLd(DOCS_FAQ)).replace(/</g, '\\u003c'),
        }}
      />

      <section className="px-section px-section--soft px-guides-hero">
        <div className="px-guides-hero-inner">
          <p className="px-badge px-badge--pill">
            <img className="px-badge-flare" src={LANDING_ASSETS.flare} alt="" width={20} height={20} />
            {DOCS_HERO.eyebrow}
          </p>
          <h1>{DOCS_HERO.title}</h1>
          <p className="px-guides-hero-lead">{DOCS_HERO.subtitle}</p>
          <p className="px-docs-updated">Updated {DOCS_UPDATED}</p>
        </div>
      </section>

      <section className="px-section px-guides-nav-section" id="guides">
        <div className="px-guides-nav-inner">
          <SectionIntro title={DOCS_NAV_SECTION.title} lead={DOCS_NAV_SECTION.lead} />
          <div className="px-guides-nav-grid">
            {DOCS_NAV_CARDS.map((card) => (
              <a key={card.href} href={card.href} className="px-get-started-card px-guides-nav-card">
                <div className="px-get-started-card-copy">
                  <p className="px-guides-nav-label">{card.label}</p>
                  <h3>{card.title}</h3>
                  <p>{card.body}</p>
                </div>
                <span className="px-get-started-arrow" aria-hidden>
                  <img src={LANDING_ASSETS.arrowForward} alt="" width={24} height={24} />
                </span>
              </a>
            ))}
          </div>
        </div>
      </section>

      {DOCS_GROUPS.map((group) => (
        <section
          key={group.id}
          className={
            group.tone === 'deep'
              ? 'px-section px-section--soft px-guides-group'
              : 'px-section px-guides-group'
          }
          id={group.id}
        >
          <SectionIntro eyebrow={group.eyebrow} title={group.title} />
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

      <section className="px-section px-section--soft px-guides-faq" id="faq">
        <SectionIntro title={DOCS_FAQ_SECTION.title} lead={DOCS_FAQ_SECTION.subtitle} />
        <BrochureFaqAccordion items={DOCS_FAQ} idPrefix="px-docs-faq" />
      </section>

      <section className="px-final-cta px-final-cta--brochure px-guides-final-cta" id="cta">
        <div className="px-final-cta-bg" aria-hidden />
        <div className="px-final-cta-content">
          <h2>
            {DOCS_FINAL_CTA.titleLine1}
            <br />
            {DOCS_FINAL_CTA.titleLine2}
          </h2>
          <p className="px-lead px-lead--center">{DOCS_FINAL_CTA.lead}</p>
          <div className="px-hero-ctas px-hero-ctas--single">
            <ShopifyCtaButton storeUrl={storeUrl} className="px-btn px-btn--dark px-btn--lg">
              {HERO.primaryCta}
            </ShopifyCtaButton>
          </div>
          <p className="px-final-fine">
            {DOCS_FINAL_CTA.fine}
            {' · '}
            <Link to={PUBLIC_ROUTES.home}>Back to Priceify</Link>
            {' · '}
            <Link to={PUBLIC_ROUTES.contact}>Contact</Link>
          </p>
        </div>
      </section>
    </div>
  );
}
