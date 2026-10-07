/**
 * Product-practice privacy page for the App Store listing URL.
 * Not legal advice — keep statements aligned with as-built scopes and runtime.
 */
export const PRIVACY_UPDATED = '29 September 2026';

export const PRIVACY_INTRO =
  'This page describes how Priceify handles data when a merchant installs the app from Shopify. It is a product-practice notice for the App Store listing, not legal advice.';

export const PRIVACY_SECTIONS = [
  {
    title: 'Who this covers',
    paragraphs: [
      'Priceify is a Shopify-embedded price and offer testing app. The tenant is the shop (session.shop). There is no email/password login on this website.',
      'Merchants install from the Shopify App Store. Shopify supplies the shop and OAuth session. This public site does not collect a shop domain or a password.',
    ],
  },
  {
    title: 'What we collect through Shopify APIs',
    paragraphs: [
      'With the scopes requested at install we read products, variants, orders, inventory, locations, themes, pages, markets, and reports so we can build price tests, map price locations, and measure results. We write products only when a merchant applies a winning price. We read and write checkout pricing functions so checkout can honor the assigned test price on Plus / development stores.',
      'Shopify notifies us when an order is placed, cancelled or refunded. From an order that includes a product in a running test we keep the order number, its merchandise subtotal and currency, and the hidden test fields on its lines. We do not store the customer’s name, email, phone or address, and orders with no tested product are discarded.',
    ],
  },
  {
    title: 'What we collect from the merchant',
    paragraphs: [
      'Shop domain and Admin session tokens (from Shopify, not typed on this site). Test names, hypotheses, variation prices, product selections, audience and metric choices, guardrails, and shop settings such as price location mappings.',
      'We do not ask merchants for their customers’ personal contact lists. We do not run a separate merchant account system.',
    ],
  },
  {
    title: 'What we collect from storefront visitors',
    paragraphs: [
      'When a test is running, Theme connection and the storefront script assign a visitor to a variation and record events needed for the test (for example assignment and conversion signals). Cart line attributes such as _ripx_* may be attached so checkout can keep the assigned price.',
      'We do not use this site to drop marketing pixels. Storefront assignment is for the price test the merchant launched, not for selling visitor data.',
    ],
  },
  {
    title: 'How we use the information',
    paragraphs: [
      'To run Priceify: create and operate tests, paint mapped prices, evaluate checkout readiness, and apply a winner when the merchant confirms. Optional AI features (when the operator has configured a model key) only rank or suggest among verified catalog or price location candidates — they do not invent CSS or write theme files.',
      'We do not sell shop or visitor data. We do not use storefront events for third-party advertising.',
    ],
  },
  {
    title: 'Storage, processors, and retention',
    paragraphs: [
      'Shop-scoped records live in our application database (Postgres). Hosting and Shopify itself are processors for install, Admin, and App Pricing. If AI features are enabled, OpenAI receives product data to suggest test prices and rank products: titles, product types, prices, margins, and sales and product-page visit counts. No customer data, shop domain or Shopify ids are sent. OpenAI does not train on data sent through its API, and keeps it for up to 30 days for abuse monitoring.',
      'When the app is uninstalled we revoke the session, pause running tests, and delete that shop’s support tickets. When Shopify sends its shop erasure request, 48 hours after uninstall, we delete every remaining record for that shop: tests, results, settings, and plans.',
      'The only customer-linked data we keep is the Shopify order number recorded with a test conversion. When Shopify forwards a customer’s erasure request we remove those order numbers and keep the anonymous conversion, so test results do not change. When a customer asks for their data, we can tell the merchant which of the customer’s orders a test recorded.',
    ],
  },
  {
    title: 'How to reach us',
    paragraphs: [
      'Installed merchants can open Help in the app (Shopify Admin → Get support). Others can use the Contact page on this site or the developer contact on the Shopify App Store listing. Some jurisdictions also expect a postal address — we will publish one there when the listing is live.',
    ],
  },
];
