/** Unauthenticated marketing / legal routes (not Shopify Admin). */
export const PUBLIC_ROUTES = {
  home: '/',
  privacy: '/privacy',
  terms: '/terms',
  contact: '/contact',
  docs: '/docs',
  docsSettings: '/docs/settings',
  /** Operator ticket queue (header Login). Merchants install from the App Store. */
  staff: '/staff/login',
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
