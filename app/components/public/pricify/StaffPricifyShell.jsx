import { useEffect, useState } from 'react';
import { Form, Link, useLocation } from 'react-router';
import { useHydrated } from '../../../hooks/useHydrated';
import PricifyLogo from './PricifyLogo';
import { clearStaffOtpDraft } from './staffOtp';
import { staffQueueBackHref } from './staffQueue';

const SKIP_HIDDEN = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0,
};

export default function StaffPricifyShell({
  children,
  showQueueNav = false,
  wide = false,
  homeTo = '/',
}) {
  const { pathname, search } = useLocation();
  const [scrolled, setScrolled] = useState(false);
  const onQueue = pathname === '/staff/support';
  // The remembered queue filters live in browser storage, so the link can only
  // point back at them once hydrated; the server and the hydration pass both
  // render the plain queue href they can agree on.
  const hydrated = useHydrated();
  const queueTo = onQueue || !hydrated ? '/staff/support' : staffQueueBackHref();
  const logoutNext = pathname.startsWith('/staff/support') ? `${pathname}${search}` : '/staff/support';

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div className="rpx-public staff-app" data-palette="pricify">
      <a className="skip" href="#public-main" style={SKIP_HIDDEN}>
        Skip to content
      </a>
      <header className={scrolled ? 'px-header is-scrolled' : 'px-header'}>
        <div className="px-header-inner">
          <div className="staff-brand-lockup">
            <PricifyLogo to={homeTo} />
            <span className="staff-header-badge">Staff</span>
          </div>
          <div className="px-header-actions">
            {showQueueNav ? (
              <>
                <Link
                  className="px-nav-link staff-queue-link"
                  to={queueTo}
                  aria-current={onQueue ? 'page' : undefined}
                >
                  Ticket queue
                </Link>
                <Form method="post" action="/staff/login" onSubmit={() => clearStaffOtpDraft()}>
                  <input type="hidden" name="intent" value="logout" />
                  <input type="hidden" name="next" value={logoutNext} />
                  <button className="px-btn px-btn--ghost" type="submit">
                    Sign out
                  </button>
                </Form>
              </>
            ) : (
              <Link className="px-btn px-btn--ghost" to="/" reloadDocument>
                Back to Pricify
              </Link>
            )}
          </div>
        </div>
      </header>
      <main id="public-main" tabIndex={-1} className={wide ? 'staff-main staff-main--wide' : 'staff-main'}>
        {children}
      </main>
      <footer className="px-footer">
        <div className="px-footer-inner staff-footer-inner">
          <PricifyLogo to={homeTo} />
          <div className="px-footer-bottom staff-footer-bottom">
            <p>© {new Date().getFullYear()} Pricify. Operator access only.</p>
            <p>Not a merchant Shopify login.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
