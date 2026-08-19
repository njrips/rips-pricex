import { Link, NavLink } from 'react-router';
import { IconArrowUpRight, IconFlask } from '../SmartPricing/classic/classicIcons';
import { PUBLIC_FOOTER_NAV, PUBLIC_HEADER_NAV } from '../../constants/publicRoutes';
import styles from '../public/publicStyles';

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

export default function PublicClassicShell({
  children,
  narrow = false,
  storeUrl = '',
  showNav = true,
}) {
  return (
    <div className="rpx-public" data-palette="admin">
      <a className={styles.skip} href="#public-main" style={SKIP_HIDDEN}>
        Skip to content
      </a>
      <header className={styles.header}>
        <Link to="/" className={styles.brand}>
          <span className={styles.mark} aria-hidden>
            <IconFlask size={16} />
          </span>
          <div>
            <p className={styles.brandName}>RipsPriceX</p>
            <p className={styles.brandMeta}>Classic Smart Pricing</p>
          </div>
        </Link>
        {showNav ? (
          <div className={styles.headerEnd}>
            <nav className={styles.nav} aria-label="Public">
              {PUBLIC_HEADER_NAV.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={Boolean(item.end)}
                  className={({ isActive }) =>
                    isActive ? `${styles.navLink} ${styles.navLinkActive}` : styles.navLink
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>
            {storeUrl ? (
              <a
                className={styles.headerCta}
                href={storeUrl}
                target="_top"
                rel="noopener noreferrer"
              >
                Install
                <IconArrowUpRight size={14} />
              </a>
            ) : null}
          </div>
        ) : null}
      </header>
      <main
        id="public-main"
        tabIndex={-1}
        className={narrow ? `${styles.main} ${styles.mainNarrow}` : styles.main}
      >
        {children}
      </main>
      <footer className={styles.footer}>
        <p className={styles.footerNote}>
          © {new Date().getFullYear()} RipsPriceX · Classic Smart Pricing
        </p>
        <nav className={styles.footerNav} aria-label="Legal">
          {PUBLIC_FOOTER_NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                isActive ? `${styles.footerLink} ${styles.footerLinkActive}` : styles.footerLink
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </footer>
    </div>
  );
}
