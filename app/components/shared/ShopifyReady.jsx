import { useEffect, useState } from 'react';

/**
 * Wait until App Bridge has set `window.shopify` (script from AppProvider).
 * Renders `fallback` until ready so hooks/components that need App Bridge don't throw.
 */
export default function ShopifyReady({ children, fallback = null }) {
  const [ready, setReady] = useState(() =>
    typeof window !== 'undefined' ? Boolean(window.shopify) : false,
  );

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    if (window.shopify) {
      setReady(true);
      return undefined;
    }

    const started = Date.now();
    const timer = window.setInterval(() => {
      if (window.shopify || Date.now() - started > 8000) {
        setReady(true);
        window.clearInterval(timer);
      }
    }, 40);

    return () => window.clearInterval(timer);
  }, []);

  if (!ready) return fallback;
  return children;
}
