/** Unauthenticated marketing / legal routes (not Shopify Admin). */
export const PUBLIC_ROUTES = {
  home: '/',
  privacy: '/privacy',
  terms: '/terms',
  faq: '/faq',
  contact: '/contact',
};

export const PUBLIC_HEADER_NAV = [
  { to: PUBLIC_ROUTES.home, label: 'Product', end: true },
  { to: PUBLIC_ROUTES.faq, label: 'FAQ' },
  { to: PUBLIC_ROUTES.contact, label: 'Contact' },
];

export const PUBLIC_FOOTER_NAV = [
  { to: PUBLIC_ROUTES.privacy, label: 'Privacy' },
  { to: PUBLIC_ROUTES.terms, label: 'Terms' },
  { to: PUBLIC_ROUTES.faq, label: 'FAQ' },
  { to: PUBLIC_ROUTES.contact, label: 'Contact' },
];
