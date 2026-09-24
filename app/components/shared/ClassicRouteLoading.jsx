import { useNavigation } from 'react-router';

/**
 * Global Classic route loader: top progress bar + full-viewport overlay spinner.
 * Mount under the app layout so NavMenu Links and programmatic navigate() are covered.
 */
export default function ClassicRouteLoading() {
  const navigation = useNavigation();
  const busy = navigation.state !== 'idle';

  if (!busy) return null;

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
