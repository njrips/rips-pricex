/**
 * GET /api/track/preview-document
 *
 * Same-origin HTML proxy for visual price-surface picking.
 * Fetches the merchant storefront page (with optional password unlock),
 * injects <base> + RipX script, and returns HTML suitable for an admin iframe.
 */
const {
  fetchStorefrontPreviewHtml,
  resolveStorefrontPasswordForPreviewRequest,
} = require('../utils/storefrontPasswordPreview');
const { SCRIPT_VERSION } = require('../utils/storefrontScriptRuntime');
const logger = require('../utils/logger');

const PREVIEW_DOCUMENT_CSP =
  "default-src 'self' https: http:; script-src 'self' https: http: 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline' https: http:; img-src 'self' data: blob: https: http:; font-src 'self' data: https: http:; frame-src 'self' https: http:; connect-src 'self' https: http:; worker-src 'self' blob: https: http:; base-uri 'self' https: http:";

function resolvePublicOrigin(req) {
  const configured = String(
    process.env.RIPSPRICEX_PUBLIC_API_BASE || process.env.APP_URL || ''
  )
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/api$/i, '');
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      return configured;
    }
  }
  const proto = String(req.get('x-forwarded-proto') || req.protocol || 'http')
    .split(',')[0]
    .trim();
  const host = String(req.get('x-forwarded-host') || req.get('host') || '127.0.0.1:3456')
    .split(',')[0]
    .trim();
  return `${proto}://${host}`;
}

/**
 * Absolute origin for injected /api/track/script.js.
 * Prefer the public/tunnel URL so HTTPS admin iframes are not mixed-content blocked,
 * and so <base href="https://shop…"> cannot rewrite root-relative /api paths to the shop.
 */
function resolveScriptOrigin(req, parentOrigin) {
  const publicOrigin = resolvePublicOrigin(req);
  if (publicOrigin && !/127\.0\.0\.1|localhost/i.test(publicOrigin)) {
    return publicOrigin;
  }
  const fromParent = String(parentOrigin || '').trim();
  if (/^https?:\/\//i.test(fromParent)) {
    try {
      const parent = new URL(fromParent).origin;
      if (parent && !/127\.0\.0\.1|localhost/i.test(parent)) {
        return parent;
      }
    } catch {
      // fall through
    }
  }
  return publicOrigin;
}

function shopFromTargetUrl(targetUrl) {
  try {
    const host = new URL(targetUrl).hostname.toLowerCase();
    if (host.endsWith('.myshopify.com')) return host;
    return host;
  } catch {
    return '';
  }
}

function buildErrorPage({ title, message, parentOrigin, reason }) {
  const safeTitle = String(title || 'Preview unavailable');
  const safeMessage = String(message || 'The storefront preview could not be loaded.');
  const safeReason = String(reason || 'error');
  const originJson = JSON.stringify(String(parentOrigin || '').trim() || '*');
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${safeTitle.replace(/</g, '&lt;')}</title>
    <style>
      body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #faf7f2; color: #231814; }
      main { max-width: 480px; margin: 12vh auto; padding: 24px; background: #fff; border: 1px solid #e9e3df; border-radius: 16px; box-shadow: 0 8px 28px rgba(35,24,20,.08); }
      h1 { font-size: 1.15rem; margin: 0 0 10px; }
      p { margin: 0; line-height: 1.5; color: #6e605a; font-size: .9375rem; }
    </style>
  </head>
  <body>
    <main>
      <h1>${safeTitle.replace(/</g, '&lt;')}</h1>
      <p>${safeMessage.replace(/</g, '&lt;')}</p>
    </main>
    <script>
      (function () {
        try {
          var payload = {
            type: 'ripx-preview-error',
            source: 'ripx-preview-document',
            reason: ${JSON.stringify(safeReason)},
            message: ${JSON.stringify(safeMessage)},
            href: String(window.location.href || '')
          };
          var target = ${originJson};
          if (window.parent && window.parent !== window) {
            window.parent.postMessage(payload, target === '*' ? '*' : target);
          }
        } catch (_e) {}
      })();
    </script>
  </body>
</html>`;
}

function stripExistingBases(html) {
  return String(html || '').replace(/<base\b[^>]*>/gi, '');
}

function injectHeadSnippet(html, snippet) {
  const raw = String(html || '');
  const headOpen = raw.match(/<head\b[^>]*>/i);
  if (headOpen && typeof headOpen.index === 'number') {
    const idx = headOpen.index + headOpen[0].length;
    return `${raw.slice(0, idx)}\n${snippet}\n${raw.slice(idx)}`;
  }
  const htmlOpen = raw.match(/<html\b[^>]*>/i);
  if (htmlOpen && typeof htmlOpen.index === 'number') {
    const idx = htmlOpen.index + htmlOpen[0].length;
    return `${raw.slice(0, idx)}\n<head>${snippet}</head>\n${raw.slice(idx)}`;
  }
  return `<!doctype html><html><head>${snippet}</head><body>${raw}</body></html>`;
}

function buildBaseHref(targetUrl) {
  const parsed = new URL(targetUrl);
  // Directory form so relative theme assets resolve correctly.
  let path = parsed.pathname || '/';
  if (!path.endsWith('/')) {
    const lastSlash = path.lastIndexOf('/');
    path = lastSlash >= 0 ? path.slice(0, lastSlash + 1) : '/';
  }
  return `${parsed.origin}${path}`;
}

function rewriteHtmlForPreviewDocument({
  html,
  targetUrl,
  shop,
  scriptSrc,
  parentOrigin,
}) {
  let next = stripExistingBases(html);
  const baseHref = buildBaseHref(targetUrl);
  const snippet = [
    `<base href="${baseHref.replace(/"/g, '&quot;')}">`,
    `<meta name="ripx-preview-document" content="1">`,
    parentOrigin
      ? `<meta name="ripx-parent-origin" content="${String(parentOrigin).replace(/"/g, '&quot;')}">`
      : '',
    `<script>window.__RIPX_FORCE_PICKER__=true;window.__RIPX_PREVIEW_DOCUMENT__=true;</script>`,
    `<script src="${String(scriptSrc).replace(/"/g, '&quot;')}" defer></script>`,
  ]
    .filter(Boolean)
    .join('\n');
  next = injectHeadSnippet(next, snippet);

  // Soft-remove Shopify frame-bust / clickjack defenses that would blank the iframe.
  next = next.replace(
    /<meta[^>]+http-equiv=["']Content-Security-Policy["'][^>]*>/gi,
    '<!-- ripx stripped storefront CSP meta -->'
  );
  next = next.replace(/X-Frame-Options/gi, 'X-RipX-Frame-Options');

  // Annotation for debugging
  next = next.replace(
    /<body\b([^>]*)>/i,
    `<body$1 data-ripx-preview-document="1" data-ripx-shop="${String(shop || '').replace(/"/g, '')}">`
  );
  return next;
}

async function servePreviewDocument(req, res) {
  const targetUrl = String(req.query.url || req.query.target || '').trim();
  const parentOrigin = String(req.query.parent_origin || '').trim();
  if (!targetUrl) {
    res
      .status(400)
      .type('html')
      .send(
        buildErrorPage({
          title: 'Missing preview URL',
          message: 'preview-document requires a url query parameter.',
          parentOrigin,
          reason: 'missing_url',
        })
      );
    return;
  }

  let parsedTarget;
  try {
    parsedTarget = new URL(targetUrl);
  } catch {
    res
      .status(400)
      .type('html')
      .send(
        buildErrorPage({
          title: 'Invalid preview URL',
          message: 'The storefront URL could not be parsed.',
          parentOrigin,
          reason: 'invalid_url',
        })
      );
    return;
  }

  if (!/^https?:$/i.test(parsedTarget.protocol)) {
    res
      .status(400)
      .type('html')
      .send(
        buildErrorPage({
          title: 'Unsupported URL',
          message: 'Only http(s) storefront URLs are allowed.',
          parentOrigin,
          reason: 'unsupported_protocol',
        })
      );
    return;
  }

  const shop =
    String(req.query.shop || req.query.domain || '').trim().toLowerCase() ||
    shopFromTargetUrl(targetUrl);
  const storefrontPassword = resolveStorefrontPasswordForPreviewRequest(
    typeof req.query.storefront_password === 'string'
      ? req.query.storefront_password
      : typeof req.query.password === 'string'
        ? req.query.password
        : '',
    req.get('host') || ''
  );

  const origin = resolveScriptOrigin(req, parentOrigin);
  const scriptSrc =
    `${origin}/api/track/script.js?shop=${encodeURIComponent(shop || parsedTarget.hostname)}` +
    `&v=${SCRIPT_VERSION}&ripx_preview_bust=${Date.now()}`;

  let fetchResult;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    fetchResult = await fetchStorefrontPreviewHtml(
      targetUrl,
      storefrontPassword,
      controller.signal
    );
    clearTimeout(timeoutId);
  } catch (err) {
    const aborted = err?.name === 'AbortError';
    logger.warn('preview-document fetch failed', {
      message: err?.message,
      aborted,
      shop,
    });
    res
      .status(502)
      .type('html')
      .send(
        buildErrorPage({
          title: aborted ? 'Preview timed out' : 'Preview fetch failed',
          message: aborted
            ? 'The storefront took too long to respond. Retry Pick, or check the product URL.'
            : 'Could not load the storefront HTML for the visual picker.',
          parentOrigin,
          reason: aborted ? 'timeout' : 'fetch_error',
        })
      );
    return;
  }

  if (!fetchResult?.ok) {
    const reason = String(fetchResult?.reason || 'fetch_failed');
    const passwordish = reason === 'password_required' || /password/i.test(reason);
    const notFound = reason === 'fetch_failed' && Number(fetchResult?.status) === 404;
    logger.warn('preview-document storefront not ready', { reason, shop, status: fetchResult?.status });
    res
      .status(passwordish ? 401 : notFound ? 404 : 502)
      .type('html')
      .send(
        buildErrorPage({
          title: passwordish
            ? 'Storefront password required'
            : notFound
              ? 'Product not found'
              : 'Preview unavailable',
          message: passwordish
            ? 'This store is password protected. Set RIPX_DEV_STOREFRONT_PASSWORD in .env (or enter it in Settings), then try Pick again.'
            : notFound
              ? 'Shopify returned 404 for this product URL. Publish the product to Online Store or pick a different handle.'
              : `Could not load storefront preview (${reason}).`,
          parentOrigin,
          reason,
        })
      );
    return;
  }

  const rewritten = rewriteHtmlForPreviewDocument({
    html: fetchResult.html,
    targetUrl,
    shop,
    scriptSrc,
    parentOrigin,
  });

  res.set('Cache-Control', 'no-store');
  res.set('Content-Security-Policy', PREVIEW_DOCUMENT_CSP);
  // Allow embedding in the admin iframe (Shopify app + tunnel origin).
  res.removeHeader('X-Frame-Options');
  res.type('html').send(rewritten);
}

/**
 * GET /api/track/preview-launch
 * Lightweight launcher: stash preview URL then redirect into preview-document (or storefront).
 */
async function servePreviewLaunch(req, res) {
  const targetUrl = String(req.query.url || '').trim();
  if (!targetUrl) {
    res.status(400).type('html').send('<!-- missing url -->');
    return;
  }

  const origin = resolvePublicOrigin(req);
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(req.query || {})) {
    if (value == null) continue;
    if (Array.isArray(value)) {
      value.forEach(v => params.append(key, String(v)));
    } else {
      params.set(key, String(value));
    }
  }
  const documentUrl = `${origin}/api/track/preview-document?${params.toString()}`;

  res
    .status(200)
    .type('html')
    .send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Opening preview…</title>
  </head>
  <body>
    <p style="font-family:sans-serif;padding:24px">Opening storefront picker…</p>
    <script>
      try { window.name = ${JSON.stringify(`__ripx_preview_launch__:${targetUrl}`)}; } catch (_e) {}
      window.location.replace(${JSON.stringify(documentUrl)});
    </script>
  </body>
</html>`);
}

module.exports = {
  servePreviewDocument,
  servePreviewLaunch,
  buildErrorPage,
  rewriteHtmlForPreviewDocument,
};
