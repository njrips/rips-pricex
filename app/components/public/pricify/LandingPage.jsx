import { useState } from 'react';
import { DEFAULT_APP_STORE_LISTING_URL } from '../../../utils/appStoreListingUrl';
import PricifyIcon from './PricifyIcon';
import PricifyLogo from './PricifyLogo';
import PublicSectionLink from './PublicSectionLink';
import {
  EXPERIMENT_INTRO,
  EXPERIMENT_MOCK,
  HERO_SETUP_MOCK,
  EXPERIMENT_POINTS,
  FAQ_ITEMS,
  FEATURE_CARDS,
  HOW_IT_WORKS_STEPS,
  PROBLEM_CARDS,
  RESULTS_BOARD,
  RESULTS_POINTS,
  USE_CASES,
  WALKTHROUGH_EYEBROW,
  WALKTHROUGH_MOCKS,
  WALKTHROUGH_STEPS,
  buildFaqJsonLd,
} from './landingContent';

function InstallButton({ storeUrl, className, children }) {
  const href = storeUrl || DEFAULT_APP_STORE_LISTING_URL;
  return (
    <a className={className} href={href} target="_top" rel="noopener noreferrer">
      {children}
    </a>
  );
}

function Eyebrow({ children, tone = 'pill' }) {
  return <p className={tone === 'plain' ? 'px-eyebrow px-eyebrow--plain' : 'px-eyebrow'}>{children}</p>;
}

function HeroCompareCard({ card, accent = false }) {
  return (
    <div className={accent ? 'px-hero-card px-hero-card--on' : 'px-hero-card'}>
      <div className="px-hero-card-head">
        <p className={accent ? 'px-hero-card-label px-hero-card-label--on' : 'px-hero-card-label'}>
          {card.label}
        </p>
        <span className={accent ? 'px-hero-share px-hero-share--on' : 'px-hero-share'}>
          {card.share}
        </span>
      </div>
      <p className="px-hero-card-price">{card.price}</p>
      <dl className="px-hero-card-stats">
        {card.stats.map((stat) => (
          <div key={stat.label}>
            <dt>{stat.label}</dt>
            <dd className={stat.lift ? 'px-hero-lift' : undefined}>
              {stat.lift ? `↑ ${stat.value}` : stat.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function HeroSetupMock() {
  return (
    <MiniApp url={HERO_SETUP_MOCK.url} wide>
      <p className="px-hero-crumb">{HERO_SETUP_MOCK.crumb}</p>
      <div className="px-app-head">
        <p className="px-app-title">{HERO_SETUP_MOCK.title}</p>
        <span className="px-running">
          <span className="px-running-dot" />
          {HERO_SETUP_MOCK.status}
        </span>
      </div>
      <p className="px-hero-meta">{HERO_SETUP_MOCK.meta}</p>
      <div className="px-hero-stats">
        <HeroCompareCard card={HERO_SETUP_MOCK.control} />
        <HeroCompareCard card={HERO_SETUP_MOCK.variation} accent />
      </div>
      <div className="px-exp-progress px-hero-progress">
        <span>Experiment progress</span>
        <strong>{HERO_SETUP_MOCK.progress}</strong>
        <span className="px-exp-progress-track">
          <span className="px-exp-progress-bar" style={{ width: HERO_SETUP_MOCK.progress }} />
        </span>
      </div>
    </MiniApp>
  );
}

function HeroBadge() {
  return (
    <p className="px-badge">
      <img className="px-badge-mark" src="/pricify/logo-mark.svg" alt="" width={22} height={22} />
      Free Shopify App
    </p>
  );
}

function MiniApp({ url, children, wide = false }) {
  return (
    <div className={wide ? 'px-window px-window--wide px-hero-mock' : 'px-window px-walk-mock'} aria-hidden>
      <div className="px-window-chrome">
        <span className="px-window-dots" />
        <p className="px-window-url">{url}</p>
        <span className="px-window-spacer" />
      </div>
      <div className="px-app">
        <aside className="px-app-side">
          <PricifyLogo compact decorative />
          {HERO_SETUP_MOCK.nav.map((item, index) => (
            <p
              key={item}
              className={index === 0 ? 'px-app-nav px-app-nav--active' : 'px-app-nav'}
            >
              <span className="px-app-dot" />
              {item}
            </p>
          ))}
        </aside>
        <div className="px-app-body">{children}</div>
      </div>
    </div>
  );
}

function WalkMock({ type }) {
  if (type === 'hypothesis') {
    const mock = WALKTHROUGH_MOCKS.hypothesis;
    return (
      <MiniApp url={mock.url}>
        <p className="px-app-title">{mock.title}</p>
        <label className="px-field">
          <span>Experiment name</span>
          <strong>{mock.name}</strong>
        </label>
        <label className="px-field">
          <span>Hypothesis</span>
          <p>{mock.hypothesis}</p>
        </label>
        <div className="px-field-row">
          <label className="px-field">
            <span>Start date</span>
            <strong className="px-field-blank" />
          </label>
          <label className="px-field">
            <span>Duration</span>
            <strong>{mock.duration}</strong>
          </label>
        </div>
        <p className="px-mock-btn">{mock.next}</p>
      </MiniApp>
    );
  }
  if (type === 'variations') {
    const mock = WALKTHROUGH_MOCKS.variations;
    return (
      <MiniApp url={mock.url}>
        <p className="px-app-title">{mock.title}</p>
        <div className="px-product-pick">
          <span className="px-check" aria-hidden />
          <div>
            <p className="px-app-title px-app-title--sm">{mock.product}</p>
            <p className="px-micro">SKU: {mock.sku}</p>
          </div>
        </div>
        <div className="px-field-row">
          <label className="px-field">
            <span>Control price</span>
            <strong>{mock.control}</strong>
          </label>
          <label className="px-field px-field--on">
            <span>Variation price</span>
            <strong>{mock.variation}</strong>
          </label>
        </div>
      </MiniApp>
    );
  }
  const mock = WALKTHROUGH_MOCKS.results;
  return (
    <MiniApp url={mock.url}>
      <p className="px-app-title">{mock.title}</p>
      <div className="px-walk-stats">
        <div>
          <p className="px-micro">CONVERSION RATE</p>
          <p className="px-stat-value">{mock.conversion.control}</p>
          <p className="px-micro">Control</p>
        </div>
        <div>
          <p className="px-micro">CONVERSION RATE</p>
          <p className="px-stat-value px-conf">↑ {mock.conversion.variation}</p>
          <p className="px-micro">Variation A</p>
        </div>
        <div>
          <p className="px-micro">REV / VISITOR</p>
          <p className="px-stat-value px-conf">{mock.revenue.variation}</p>
          <p className="px-micro">Variation A</p>
        </div>
      </div>
      <p className="px-micro">CONVERSION RATE COMPARISON</p>
      <div className="px-exp-chart">
        <p>Control vs Variation A</p>
        <div className="px-exp-bars">
          <span className="px-exp-bar" style={{ width: '52%' }} />
          <span className="px-exp-bar px-exp-bar--on" style={{ width: '72%' }} />
        </div>
      </div>
    </MiniApp>
  );
}

function ExperimentMock() {
  return (
    <div className="px-panel px-exp-mock" aria-hidden>
      <p className="px-exp-heading">{EXPERIMENT_MOCK.heading}</p>
      <div className="px-exp-pills">
        <span className="px-exp-pill">{EXPERIMENT_MOCK.controlShare}</span>
        <span className="px-exp-pill px-exp-pill--on">{EXPERIMENT_MOCK.variationShare}</span>
      </div>
      <div className="px-exp-prices">
        <div>
          <p className="px-micro">{EXPERIMENT_MOCK.control.label}</p>
          <p className="px-exp-price">{EXPERIMENT_MOCK.control.price}</p>
          <div className="px-exp-stats">
            {EXPERIMENT_MOCK.control.stats.map((stat) => (
              <p key={stat.label}>
                <span>{stat.label}</span>
                <strong>{stat.value}</strong>
              </p>
            ))}
          </div>
        </div>
        <div>
          <p className="px-micro px-exp-var-label">{EXPERIMENT_MOCK.variation.label}</p>
          <p className="px-exp-price px-exp-price--on">{EXPERIMENT_MOCK.variation.price}</p>
          <div className="px-exp-stats">
            {EXPERIMENT_MOCK.variation.stats.map((stat) => (
              <p key={stat.label}>
                <span>{stat.label}</span>
                <strong>{stat.value}</strong>
              </p>
            ))}
          </div>
        </div>
      </div>
      <div className="px-exp-progress">
        <span>Experiment progress</span>
        <strong>{EXPERIMENT_MOCK.progress}</strong>
        <span className="px-exp-progress-track">
          <span className="px-exp-progress-bar" style={{ width: EXPERIMENT_MOCK.progress }} />
        </span>
      </div>
      <p className="px-micro">PERFORMANCE COMPARISON</p>
      {EXPERIMENT_MOCK.charts.map((chart) => (
        <div key={chart.label} className="px-exp-chart">
          <p>{chart.label}</p>
          <div className="px-exp-bars">
            <span className="px-exp-bar" style={{ width: `${chart.control}%` }} />
            <span className="px-exp-bar px-exp-bar--on" style={{ width: `${chart.variant}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function ResultsBoard() {
  return (
    <div className="px-panel px-results-board" aria-hidden>
      <div className="px-results-head">
        <span className="px-badge-win">{RESULTS_BOARD.winner}</span>
      </div>
      <div className="px-cmp-table">
        <div className="px-cmp-head">
          <span />
          {RESULTS_BOARD.columns.map((column) => (
            <span key={column}>{column}</span>
          ))}
        </div>
        <div className="px-cmp-row">
          <strong>{RESULTS_BOARD.control.name}</strong>
          <span>{RESULTS_BOARD.control.conv}</span>
          <span>{RESULTS_BOARD.control.rev}</span>
          <span>{RESULTS_BOARD.control.lift}</span>
        </div>
        <div className="px-cmp-row px-cmp-row--win">
          <strong>{RESULTS_BOARD.variation.name}</strong>
          <span className="px-conf">{RESULTS_BOARD.variation.conv}</span>
          <span className="px-conf">{RESULTS_BOARD.variation.rev}</span>
          <span className="px-cmp-lift">{RESULTS_BOARD.variation.lift}</span>
        </div>
      </div>
      <p className="px-results-insight">{RESULTS_BOARD.insight}</p>
    </div>
  );
}

function FaqAccordion() {
  const [open, setOpen] = useState(0);

  return (
    <div className="px-faq">
      {FAQ_ITEMS.map((item, index) => {
        const expanded = open === index;
        return (
          <div key={item.q} className={expanded ? 'px-faq-item px-faq-item--open' : 'px-faq-item'}>
            <button
              type="button"
              className="px-faq-q"
              aria-expanded={expanded}
              aria-controls={`px-faq-a-${index}`}
              id={`px-faq-q-${index}`}
              onClick={() => setOpen(expanded ? -1 : index)}
            >
              <span>{item.q}</span>
              <span className={expanded ? 'px-faq-toggle px-faq-toggle--on' : 'px-faq-toggle'} aria-hidden>
                {expanded ? '−' : '+'}
              </span>
            </button>
            <p
              className="px-faq-a"
              id={`px-faq-a-${index}`}
              role="region"
              aria-labelledby={`px-faq-q-${index}`}
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

export default function LandingPage({ storeUrl }) {
  return (
    <div className="px-landing">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(buildFaqJsonLd()).replace(/</g, '\\u003c'),
        }}
      />
      <section className="px-hero">
        <div className="px-hero-copy">
          <HeroBadge />
          <h1>Test your Shopify prices before changing them for everyone.</h1>
          <p className="px-lead">
            Run pricing experiments on your products, compare different prices with real shoppers,
            and use data to make better pricing decisions — completely free.
          </p>
          <div className="px-hero-ctas">
            <InstallButton storeUrl={storeUrl} className="px-btn px-btn--brand px-btn--lg">
              Install free on Shopify →
            </InstallButton>
            <PublicSectionLink hash="how-it-works" className="px-btn px-btn--ghost px-btn--lg">
              See how it works
            </PublicSectionLink>
          </div>
          <p className="px-fine">No coding required · Free to use</p>
        </div>
        <HeroSetupMock />
      </section>

      <section className="px-section px-section--deep">
        <div className="px-section-head">
          <Eyebrow>THE PROBLEM</Eyebrow>
          <h2>Stop guessing what your products should cost.</h2>
          <p>
            Changing a product&apos;s price for every shopper is a decision based on assumptions.
            Pricify lets you test different prices with real shoppers first, so you can make pricing
            decisions based on actual results.
          </p>
        </div>
        <div className="px-cards">
          {PROBLEM_CARDS.map((card, index) => (
            <article key={card.title} className="px-card">
              <span className="px-num-badge">{String(index + 1).padStart(2, '0')}</span>
              <h3>{card.title}</h3>
              <p>{card.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="px-section" id="how-it-works">
        <div className="px-section-head">
          <Eyebrow>HOW IT WORKS</Eyebrow>
          <h2>Run a pricing experiment in four simple steps.</h2>
        </div>
        <ol className="px-step-grid">
          {HOW_IT_WORKS_STEPS.map((step, index) => (
            <li key={step.title} className="px-card">
              <span className="px-num-badge">{String(index + 1).padStart(2, '0')}</span>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="px-section px-section--deep">
        <div className="px-section-head">
          <Eyebrow tone="plain">{WALKTHROUGH_EYEBROW}</Eyebrow>
          <h2>Everything you need to test pricing with confidence.</h2>
        </div>
        <div className="px-walk">
          {WALKTHROUGH_STEPS.map((step, index) => (
            <article
              key={step.title}
              className={index % 2 === 1 ? 'px-walk-row px-walk-row--flip' : 'px-walk-row'}
            >
              <WalkMock type={step.mock} />
              <div className="px-walk-copy">
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="px-section" id="features">
        <div className="px-section-head">
          <Eyebrow>WHY PRICIFY</Eyebrow>
          <h2>Built to help you make smarter pricing decisions.</h2>
        </div>
        <div className="px-stack-cards">
          {FEATURE_CARDS.map((card) => (
            <article key={card.title} className="px-card px-card--row">
              <span className="px-icon-badge px-icon-badge--brand">
                <PricifyIcon name={card.icon} />
              </span>
              <div>
                <h3>{card.title}</h3>
                <p>{card.body}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="px-section">
        <div className="px-split">
          <div>
            <Eyebrow>EXPERIMENT SAFELY</Eyebrow>
            <h2>Experiment without changing your entire store at once.</h2>
            <p>{EXPERIMENT_INTRO}</p>
            <ul className="px-point-list">
              {EXPERIMENT_POINTS.map((point) => (
                <li key={point.title}>
                  <strong>{point.title}</strong>
                  <span>{point.body}</span>
                </li>
              ))}
            </ul>
          </div>
          <ExperimentMock />
        </div>
      </section>

      <section className="px-section">
        <div className="px-results">
          <ResultsBoard />
          <div className="px-results-copy">
            <Eyebrow>RESULTS &amp; ANALYTICS</Eyebrow>
            <h2>Turn pricing experiments into actionable insights.</h2>
            <p>
              Pricify helps you understand how each price variation performs so you can make your
              next pricing decision with more confidence.
            </p>
            <ul className="px-point-list">
              {RESULTS_POINTS.map((point) => (
                <li key={point}>
                  <span>{point}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="px-section px-section--deep" id="use-cases">
        <div className="px-section-head">
          <Eyebrow>USE CASES</Eyebrow>
          <h2>What could you test with Pricify?</h2>
        </div>
        <div className="px-cards px-cards--2x2">
          {USE_CASES.map((card) => (
            <article key={card.title} className="px-card">
              <p className="px-usecase-label">{card.label}</p>
              <h3>{card.title}</h3>
              <p>{card.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="px-section" id="faq">
        <div className="px-section-head">
          <h2>Frequently asked questions</h2>
        </div>
        <FaqAccordion />
      </section>

      <section className="px-cta-wrap" id="cta">
        <div className="px-cta">
          <h2>Ready to test your prices?</h2>
          <p>Install Pricify and start running pricing experiments on your Shopify store for free.</p>
          <InstallButton storeUrl={storeUrl} className="px-btn px-btn--brand px-btn--lg">
            Install free on Shopify
          </InstallButton>
          <p className="px-cta-fine">
            Start experimenting without adding another paid experimentation platform to your stack.
          </p>
        </div>
      </section>
    </div>
  );
}
