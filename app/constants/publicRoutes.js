/** Unauthenticated marketing / legal routes (not Shopify Admin). */
export const PUBLIC_ROUTES = {
  home: '/',
  privacy: '/privacy',
  terms: '/terms',
  contact: '/contact',
  docs: '/docs',
  docsSettings: '/docs/settings',
  /** Priceify Console sign-in for the team. Merchants install from the App Store. */
  console: '/console/sign-in',
};

export const PUBLIC_ANCHORS = {
  howItWorks: '/#how-it-works',
  features: '/#features',
  pricing: '/#pricing',
  faq: '/#faq',
  cta: '/#cta',
};

export const PUBLIC_HEADER_NAV = [
  { to: PUBLIC_ANCHORS.features, label: 'Features' },
  { to: PUBLIC_ANCHORS.howItWorks, label: 'How it works' },
  { to: PUBLIC_ANCHORS.pricing, label: 'Pricing' },
  { href: PUBLIC_ROUTES.docs, label: 'Guides' },
  { to: PUBLIC_ANCHORS.faq, label: 'FAQ' },
];
