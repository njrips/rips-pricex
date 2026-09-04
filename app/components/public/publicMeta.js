export function publicErrorTitle(notFound) {
  return notFound ? 'Page not found — Priceify' : 'Something went wrong — Priceify';
}

export function publicMeta({ title, description, path = '/', noIndex = false }) {
  const fullTitle = title.includes('Priceify') ? title : `${title} — Priceify`;
  const canonicalPath = path === '/' ? '/' : path;

  return [
    { title: fullTitle },
    description ? { name: 'description', content: description } : null,
    { name: 'theme-color', content: '#ffffff' },
    { name: 'application-name', content: 'Priceify' },
    noIndex ? { name: 'robots', content: 'noindex, nofollow' } : null,
    { property: 'og:site_name', content: 'Priceify' },
    { property: 'og:title', content: fullTitle },
    { property: 'og:type', content: 'website' },
    description ? { property: 'og:description', content: description } : null,
    { name: 'twitter:card', content: 'summary' },
    { name: 'twitter:title', content: fullTitle },
    description ? { name: 'twitter:description', content: description } : null,
    { tagName: 'link', rel: 'canonical', href: canonicalPath },
  ].filter(item => item !== null);
}
