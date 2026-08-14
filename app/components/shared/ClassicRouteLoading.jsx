import { useEffect, useState } from 'react';
import { useNavigation } from 'react-router';

/** Delay before show — avoids flash on instant transitions. */
const SHOW_DELAY_MS = 120;

/**
 * Global Classic route loader: top progress bar + light overlay spinner.
 * Mount under the app layout so NavMenu Links and programmatic navigate() are covered.
 */
export default function ClassicRouteLoading() {
  const navigation = useNavigation();
  const busy = navigation.state !== 'idle';
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!busy) {
      setVisible(false);
      return undefined;
    }
    const timer = window.setTimeout(() => setVisible(true), SHOW_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [busy]);

  if (!visible) return null;

  return (
    <div className="rpx-route-loading" aria-busy="true" aria-live="polite">
      <div
        className="rpx-route-loading__bar"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Loading page"
      />
      <div className="rpx-route-loading__overlay">
        <div className="rpx-route-loading__panel">
          <div className="rpx-route-loading__spinner" aria-hidden="true" />
          <p className="rpx-route-loading__label">Loading…</p>
        </div>
      </div>
    </div>
  );
}
