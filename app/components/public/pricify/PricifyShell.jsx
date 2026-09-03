import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { PUBLIC_HEADER_NAV } from '../../../constants/publicRoutes';
import { useKeyedState } from '../../../hooks/useKeyedState';
import { DEFAULT_APP_STORE_LISTING_URL } from '../../../utils/appStoreListingUrl';
import { FOOTER_BLURB, FOOTER_COLUMNS, FOOTER_TAGLINE } from './landingContent';
import PricifyLogo from './PricifyLogo';
import PublicSectionLink from './PublicSectionLink';
import { scheduleScrollPublicPageTop, scheduleScrollToPublicHash } from './scrollToPublicHash';

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

function InstallLink({ storeUrl, className, children }) {
  const href = storeUrl || DEFAULT_APP_STORE_LISTING_URL;
  return (
    <a className={className} href={href} target="_top" rel="noopener noreferrer">
      {children}
    </a>
  );
}

export default function PricifyShell({
  children,
  storeUrl = '',
  showNav = true,
  fullBleed = false,
}) {
  const { pathname, hash } = useLocation();
  // Navigating anywhere closes the mobile menu; tying it to the location means
  // the closed state is simply what a new route reads, with no reopen flicker.
  const [menuOpen, setMenuOpen] = useKeyedState(`${pathname}${hash}`, false);
  const [scrolled, setScrolled] = useState(false);
  const prevPathRef = useRef(pathname);
  const prevHashRef = useRef(hash);

  useEffect(() => {
    const prevPath = prevPathRef.current;
    const prevHash = prevHashRef.current;
    prevPathRef.current = pathname;
    prevHashRef.current = hash;

    if (pathname !== '/' && !pathname.startsWith('/docs')) return;
    if (hash) {
      scheduleScrollToPublicHash(hash);
      return;
    }
    if (prevHash || prevPath !== '/') {
      scheduleScrollPublicPageTop();
    }
  }, [pathname, hash]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const html = document.documentElement;
    const previousBody = document.body.style.overflow;
    const previousHtml = html.style.overflow;
    document.body.style.overflow = 'hidden';
    html.style.overflow = 'hidden';
    const onKey = (event) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previousBody;
      html.style.overflow = previousHtml;
      window.removeEventListener('keydown', onKey);
    };
  }, [menuOpen, setMenuOpen]);

  return (
    <div className="rpx-public" data-palette="pricify">
      <a className="skip" href="#public-main" style={SKIP_HIDDEN}>
        Skip to content
      </a>
      <header className={scrolled ? 'px-header is-scrolled' : 'px-header'}>
        <div className={menuOpen ? 'px-header-inner is-open' : 'px-header-inner'}>
          <PricifyLogo onNavigate={() => setMenuOpen(false)} />
          {showNav ? (
            <>
              <button
                type="button"
                className="px-menu-btn"
                aria-expanded={menuOpen}
                aria-controls="px-site-nav"
                aria-label={menuOpen ? 'Close menu' : 'Open menu'}
                onClick={() => setMenuOpen((open) => !open)}
              >
                {menuOpen ? 'Close' : 'Menu'}
              </button>
              <nav id="px-site-nav" className="px-nav" aria-label="Product">
                {PUBLIC_HEADER_NAV.map((item) =>
                  item.href ? (
                    <Link
                      key={item.href}
                      to={item.href}
                      className={
                        pathname.startsWith(item.href)
                          ? 'px-nav-link is-active'
                          : 'px-nav-link'
                      }
                      onClick={() => setMenuOpen(false)}
                    >
                      {item.label}
                    </Link>
                  ) : (
                    <PublicSectionLink
                      key={item.to}
                      hash={item.to}
                      className="px-nav-link"
                      onNavigate={() => setMenuOpen(false)}
                    >
                      {item.label}
                    </PublicSectionLink>
                  )
                )}
              </nav>
              <div className="px-header-actions">
                <InstallLink storeUrl={storeUrl} className="px-btn px-btn--brand">
                  Install free on Shopify
                </InstallLink>
              </div>
            </>
          ) : null}
        </div>
      </header>
      <main
        id="public-main"
        tabIndex={-1}
        className={fullBleed ? 'px-main-full' : 'main mainNarrow'}
      >
        {children}
      </main>
      <footer className="px-footer">
        <div className="px-footer-inner">
          <div className="px-footer-top">
            <div className="px-footer-brand">
              <PricifyLogo />
              <p className="px-footer-blurb">{FOOTER_BLURB}</p>
            </div>
            <div className="px-footer-cols">
              {FOOTER_COLUMNS.map((column) => (
                <div key={column.heading} className="px-footer-col">
                  <p className="px-footer-heading">{column.heading}</p>
                  {column.links.map((link) => {
                    if (link.hash) {
                      return (
                        <PublicSectionLink key={link.label} hash={link.hash}>
                          {link.label}
                        </PublicSectionLink>
                      );
                    }
                    if (link.install) {
                      return (
                        <InstallLink key={link.label} storeUrl={storeUrl}>
                          {link.label}
                        </InstallLink>
                      );
                    }
                    const staffPath = String(link.to || '').startsWith('/staff');
                    return (
                      <Link key={link.label} to={link.to} reloadDocument={staffPath || undefined}>
                        {link.label}
                      </Link>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
          <div className="px-footer-bottom">
            <p>© {new Date().getFullYear()} Pricify. All rights reserved.</p>
            <p>{FOOTER_TAGLINE}</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
