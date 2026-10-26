import { useEffect, useState } from 'react';
import { Form, Link, useLocation } from 'react-router';
import { useHydrated } from '../../../hooks/useHydrated';
import PriceifyLogo from './PriceifyLogo';
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

function inSection(pathname, base) {
  return pathname === base || pathname.startsWith(`${base}/`);
}

/**
 * @param {{
 *   children?: import('react').ReactNode,
 *   member?: { email: string, displayName?: string, role: string } | null,
 *   wide?: boolean,
 *   homeTo?: string,
 * }} props
 */
export default function ConsoleShell({ children, member = null, wide = false, homeTo = '/' }) {
  const { pathname, search } = useLocation();
  const [scrolled, setScrolled] = useState(false);
  const onQueue = pathname === '/console/tickets';
  // The remembered queue filters live in browser storage, so the link can only
  // point back at them once hydrated; the server and the hydration pass both
  // render the plain queue href they can agree on.
  const hydrated = useHydrated();
  const ticketsTo = onQueue || !hydrated ? '/console/tickets' : staffQueueBackHref();
  const signOutNext = pathname.startsWith('/console/') ? `${pathname}${search}` : '/console/tickets';
  const nav = member
    ? [
        { to: ticketsTo, base: '/console/tickets', label: 'Tickets' },
        { to: '/console/stores', base: '/console/stores', label: 'Stores' },
        ...(member.role === 'owner' ? [{ to: '/console/team', base: '/console/team', label: 'Team' }] : []),
      ]
    : [];

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div className="rpx-public staff-app" data-palette="priceify">
      <a className="skip" href="#public-main" style={SKIP_HIDDEN}>
        Skip to content
      </a>
      <header className={scrolled ? 'px-header is-scrolled' : 'px-header'}>
        <div className="px-header-inner">
          <div className="staff-brand-lockup">
            <PriceifyLogo to={homeTo} />
            <span className="staff-header-badge">Console</span>
          </div>
          <div className="px-header-actions">
            {member ? (
              <>
                <nav className="console-nav" aria-label="Console">
                  {nav.map((item) => {
                    const active = inSection(pathname, item.base);
                    return (
                      <Link
                        key={item.base}
                        className="px-nav-link staff-queue-link"
                        to={item.to}
                        aria-current={active ? 'page' : undefined}
                      >
                        {item.label}
                      </Link>
                    );
                  })}
                </nav>
                <span className="console-member" title={member.email}>
                  {member.displayName || member.email}
                </span>
                <Form method="post" action="/console/sign-in" onSubmit={() => clearStaffOtpDraft()}>
                  <input type="hidden" name="intent" value="logout" />
                  <input type="hidden" name="next" value={signOutNext} />
                  <button className="px-btn px-btn--ghost" type="submit">
                    Sign out
                  </button>
                </Form>
              </>
            ) : (
              <Link className="px-btn px-btn--ghost" to="/" reloadDocument>
                Back to Priceify
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
          <PriceifyLogo to={homeTo} />
          <div className="px-footer-bottom staff-footer-bottom">
            <p>© {new Date().getFullYear()} Priceify. For the Priceify team only.</p>
            <p>Not a merchant Shopify login.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
