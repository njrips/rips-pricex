import { useEffect } from 'react';
import { useNavigation } from 'react-router';
import { useKeyedState } from '../../hooks/useKeyedState';

/** Delay before show — avoids flash on instant transitions. */
const SHOW_DELAY_MS = 120;

/**
 * Global Classic route loader: top progress bar + light overlay spinner.
 * Mount under the app layout so NavMenu Links and programmatic navigate() are covered.
 */
export default function ClassicRouteLoading() {
  const navigation = useNavigation();
  // Scope "we have waited long enough to show a loader" to the navigation that
  // earned it. Going idle drops the key, so the loader hides by reading a fresh
  // value rather than by an effect racing to switch it off.
  const navKey = navigation.state === 'idle' ? null : navigation.location?.key || 'busy';
  const [visible, setVisible] = useKeyedState(navKey, false);

  useEffect(() => {
    if (!navKey) return undefined;
    const timer = window.setTimeout(() => setVisible(true), SHOW_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [navKey, setVisible]);

  if (!navKey || !visible) return null;

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
