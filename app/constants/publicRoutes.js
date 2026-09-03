/** Unauthenticated marketing / legal routes (not Shopify Admin). */
export const PUBLIC_ROUTES = {
  home: '/',
  privacy: '/privacy',
  terms: '/terms',
  contact: '/contact',
  docs: '/docs',
  docsSettings: '/docs/settings',
  /** CLI / shop-handle utility. Not linked from marketing — install is App Store. */
  login: '/auth/login',
  /** Operator ticket queue. Not a merchant Shopify login. */
  staff: '/staff/login',
};

export const PUBLIC_ANCHORS = {
  howItWorks: '/#how-it-works',
  features: '/#features',
  useCases: '/#use-cases',
  faq: '/#faq',
  cta: '/#cta',
};

export const PUBLIC_HEADER_NAV = [
  { to: PUBLIC_ANCHORS.howItWorks, label: 'How it works' },
  { to: PUBLIC_ANCHORS.features, label: 'Features' },
  { to: PUBLIC_ANCHORS.faq, label: 'FAQ' },
  { href: PUBLIC_ROUTES.docs, label: 'Guides' },
];
