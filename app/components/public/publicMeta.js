export function publicErrorTitle(notFound) {
  return notFound ? 'Page not found — Pricify' : 'Something went wrong — Pricify';
}

export function publicMeta({ title, description, path = '/', noIndex = false }) {
  const fullTitle = title.includes('Pricify') ? title : `${title} — Pricify`;
  const canonicalPath = path === '/' ? '/' : path;

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
    { name: 'twitter:card', content: 'summary' },
    { name: 'twitter:title', content: fullTitle },
    description ? { name: 'twitter:description', content: description } : null,
    { tagName: 'link', rel: 'canonical', href: canonicalPath },
  ].filter(item => item !== null);
}
