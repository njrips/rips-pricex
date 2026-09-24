/**
 * Full-viewport loader for client-side page/data fetches (inbox, analytics, wizard bootstrap).
 * Route changes use ClassicRouteLoading in the app layout instead.
 */
export default function ClassicPageLoader({ label = 'Loading…' }) {
  return (
    <div className="rpx-page-loader" role="status" aria-live="polite" aria-busy="true">
      <div className="rpx-route-loading__panel">
        <div className="rpx-route-loading__spinner" aria-hidden="true" />
        <p className="rpx-route-loading__label">{label}</p>
      </div>
    </div>
  );
}
