function publicOrigin() {
  try {
    return String(process.env.SHOPIFY_APP_URL || process.env.APP_URL || '').replace(/\/$/, '');
  } catch {
    return '';
  }
}

export function publicErrorTitle(notFound) {
  return notFound ? 'Page not found — Pricify' : 'Something went wrong — Pricify';
}

export function publicMeta({ title, description, path = '/', noIndex = false }) {
  const fullTitle = title.includes('Pricify') ? title : `${title} — Pricify`;
  const origin = publicOrigin();
  const url = origin ? `${origin}${path === '/' ? '/' : path}` : '';

  return [
    { title: fullTitle },
    description ? { name: 'description', content: description } : null,
    { name: 'theme-color', content: '#ffffff' },
    { name: 'application-name', content: 'Pricify' },
    noIndex ? { name: 'robots', content: 'noindex, nofollow' } : null,
    { property: 'og:site_name', content: 'Pricify' },
    { property: 'og:title', content: fullTitle },
    { property: 'og:type', content: 'website' },
    description ? { property: 'og:description', content: description } : null,
    url ? { property: 'og:url', content: url } : null,
    origin ? { property: 'og:image', content: `${origin}/pricify/favicon.svg` } : null,
    { name: 'twitter:card', content: 'summary' },
    { name: 'twitter:title', content: fullTitle },
    description ? { name: 'twitter:description', content: description } : null,
    url ? { tagName: 'link', rel: 'canonical', href: url } : null,
  ].filter(Boolean);
}
