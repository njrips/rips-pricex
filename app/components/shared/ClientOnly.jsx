import { useEffect, useState } from 'react';

/**
 * Render `fallback` on the server and the first client paint, then `children` after mount.
 * Avoids React Router full-document hydration mismatches from App Bridge, Polaris, and
 * browser extensions (which otherwise remount #document and strip stylesheet links).
 */
export default function ClientOnly({ children, fallback = null }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return fallback;
  }

  return children;
}
