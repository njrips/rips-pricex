/**
 * Product-practice privacy page for the App Store listing URL.
 * Not legal advice — keep statements aligned with as-built scopes and runtime.
 */
export const PRIVACY_UPDATED = '14 August 2026';

export const PRIVACY_INTRO =
  'This page describes how RipsPriceX handles data when a merchant installs the app from Shopify. It is a product-practice notice for the App Store listing, not legal advice.';

export const PRIVACY_SECTIONS = [
  {
    title: 'Who this covers',
    paragraphs: [
      'RipsPriceX is a Shopify-embedded Smart Pricing app. The tenant is the shop (session.shop). There is no email/password login on this website.',
      'Merchants install from the Shopify App Store. Shopify supplies the shop and OAuth session. This public site does not collect a shop domain or a password.',
    ],
  },
  {
    title: 'What we collect through Shopify APIs',
    paragraphs: [
      'With the scopes requested at install we read products, variants, orders, inventory, locations, themes, pages, markets, and reports so we can build price tests, map price selectors, and measure results. We write products only when a merchant applies a winning price. We read and write cart transforms so checkout can honor the assigned test price on Plus / development stores.',
    ],
  },
  {
    title: 'What we collect from the merchant',
    paragraphs: [
      'Shop domain and Admin session tokens (from Shopify, not typed on this site). Experiment names, hypotheses, variation prices, product selections, audience and metric choices, guardrails, and shop settings such as price-surface mappings.',
      'We do not ask merchants for their customers’ personal contact lists. We do not run a separate merchant account system.',
    ],
  },
  {
    title: 'What we collect from storefront visitors',
    paragraphs: [
      'When a test is running, the theme embed and storefront script assign a visitor to a variation and record events needed for the experiment (for example assignment and conversion signals). Cart line attributes such as _ripx_* may be attached so checkout can keep the assigned price.',
      'We do not use this site to drop marketing pixels. Storefront assignment is for the price test the merchant launched, not for selling visitor data.',
    ],
  },
  {
    title: 'How we use the information',
    paragraphs: [
      'To run Classic Smart Pricing: create and operate experiments, paint mapped prices, evaluate checkout readiness, and apply a winner when the merchant confirms. Optional AI features (when the operator has configured a model key) only rank or suggest among verified catalog or selector candidates — they do not invent CSS or write theme files.',
      'We do not sell shop or visitor data. We do not use storefront events for third-party advertising.',
    ],
  },
  {
    title: 'Storage, processors, and retention',
    paragraphs: [
      'Shop-scoped records live in our application database (Postgres). Hosting and Shopify itself are processors for install, Admin, and App Pricing. If AI features are enabled, the configured model provider may receive the minimum prompt needed to rank a suggestion.',
      'When the app is uninstalled we revoke the session and pause running tests. Merchants can use Contact to request deletion of remaining shop-scoped records. Mandatory Shopify customer-privacy webhooks are on the App Store compliance roadmap if listing requires them.',
    ],
  },
  {
    title: 'How to reach us',
    paragraphs: [
      'Use the Contact page on this site, or the developer contact on the Shopify App Store listing. Some jurisdictions also expect a postal address — we will publish one there when the listing is live.',
    ],
  },
];
