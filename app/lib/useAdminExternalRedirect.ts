import { useCallback } from 'react';
import {
  isAdminNavigationUrl,
  toShopifyAdminNavigationUrl,
} from '../utils/shopifyAdminNavigationUrl';

type ShopifyGlobal = {
  intents?: {
    redirect?: (url: string) => void;
  };
};

/**
 * Open a Shopify admin / theme-editor / App Pricing URL from the embedded iframe.
 * Always break out of the app iframe (`_top`) — never navigate the iframe itself
 * to admin.shopify.com (that triggers "refused to connect").
 *
 * Prefer `shopify://admin/...` when the input is an Admin HTTPS URL.
 * Callers may pass an override URL: `open(url?)`.
 *
 * @see https://shopify.dev/docs/api/app-home/apis/user-interface-and-interactions/navigation-api
 */
export function useAdminExternalRedirect(url?: string | null) {
  return useCallback(
    (overrideUrl?: string | null) => {
      const original = String(
        overrideUrl != null && String(overrideUrl).trim()
          ? overrideUrl
          : url || '',
      ).trim();
      if (!original) return;

      const href = isAdminNavigationUrl(original)
        ? toShopifyAdminNavigationUrl(original)
        : original;

      // App Bridge v4 polyfills window.open for shopify:// and remote admin URLs.
      try {
        if (typeof open === 'function') {
          open(href, '_top');
          return;
        }
      } catch {
        // fall through
      }

      try {
        const shopify =
          typeof window !== 'undefined'
            ? (window as Window & { shopify?: ShopifyGlobal }).shopify
            : undefined;
        if (typeof shopify?.intents?.redirect === 'function') {
          shopify.intents.redirect(href);
          return;
        }
      } catch {
        // fall through
      }

      try {
        if (typeof window !== 'undefined' && typeof window.open === 'function') {
          window.open(href, '_top');
          return;
        }
      } catch {
        // fall through
      }

      // Last resort: synthetic <a target="_top"> — never window.location (iframe).
      try {
        if (typeof document !== 'undefined') {
          const anchor = document.createElement('a');
          anchor.href = href;
          anchor.target = '_top';
          anchor.rel = 'noopener';
          document.body.appendChild(anchor);
          anchor.click();
          anchor.remove();
        }
      } catch {
        // give up silently
      }
    },
    [url],
  );
}

export { toShopifyAdminNavigationUrl, isAdminNavigationUrl };
