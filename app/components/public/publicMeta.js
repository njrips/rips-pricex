function publicOrigin() {
  try {
    return String(process.env.SHOPIFY_APP_URL || process.env.APP_URL || '').replace(/\/$/, '');
  } catch {
    return '';
  }
}

export function publicMeta({ title, description, path = '/', noIndex = false }) {
  const fullTitle = title.includes('RipsPriceX') ? title : `${title} — RipsPriceX`;
  const origin = publicOrigin();
  const url = origin ? `${origin}${path === '/' ? '/' : path}` : '';

  return [
    { title: fullTitle },
    description ? { name: 'description', content: description } : null,
    { name: 'theme-color', content: '#fefbf8' },
    noIndex ? { name: 'robots', content: 'noindex, nofollow' } : null,
    { property: 'og:title', content: fullTitle },
    { property: 'og:type', content: 'website' },
    description ? { property: 'og:description', content: description } : null,
    url ? { property: 'og:url', content: url } : null,
    url ? { tagName: 'link', rel: 'canonical', href: url } : null,
  ].filter(Boolean);
}
