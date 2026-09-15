import { useState } from 'react';
import { Link } from 'react-router';
import { PUBLIC_ROUTES } from '../../../constants/publicRoutes';
import { DEFAULT_APP_STORE_LISTING_URL } from '../../../utils/appStoreListingUrl';
import {
  FOOTER_BRAND_TAGLINE,
  FOOTER_COPYRIGHT,
  FOOTER_LINK_SECTIONS,
  FOOTER_NEWSLETTER,
  FOOTER_SOCIAL,
  LANDING_ASSETS,
} from './landingContent';
import PriceifyLogo from './PriceifyLogo';
import PublicSectionLink from './PublicSectionLink';

function FooterLink({ link, storeUrl }) {
  if (link.hash) {
    return <PublicSectionLink hash={link.hash}>{link.label}</PublicSectionLink>;
  }
  if (link.install) {
    const href = storeUrl || DEFAULT_APP_STORE_LISTING_URL;
    return (
      <a href={href} target="_top" rel="noopener noreferrer">
        {link.label}
      </a>
    );
  }
  if (link.muted) {
    return <span className="px-footer-muted">{link.label}</span>;
  }
  const staffPath = String(link.to || '').startsWith('/staff');
  return (
    <Link to={link.to} reloadDocument={staffPath || undefined}>
      {link.label}
    </Link>
  );
}

export default function PriceifyFooter({ storeUrl = '' }) {
  const [email, setEmail] = useState('');

  return (
    <footer className="px-footer px-footer--brochure">
      <div className="px-footer-newsletter-band">
        <div className="px-footer-inner px-footer-inner--wide">
          <div className="px-footer-brand-block">
            <div className="px-footer-logo">
              <PriceifyLogo decorative className="px-logo--footer" />
            </div>
            <p className="px-footer-brand-tagline">{FOOTER_BRAND_TAGLINE}</p>
          </div>
          <div className="px-footer-signup">
            <p className="px-footer-signup-title">{FOOTER_NEWSLETTER.title}</p>
            <form
              className="px-footer-signup-form"
              onSubmit={event => {
                event.preventDefault();
                const next = email.trim()
                  ? `${PUBLIC_ROUTES.contact}?subject=Newsletter&email=${encodeURIComponent(email.trim())}`
                  : PUBLIC_ROUTES.contact;
                window.location.assign(next);
              }}
            >
              <label className="px-sr-only" htmlFor="px-footer-email">
                Email address
              </label>
              <input
                id="px-footer-email"
                className="px-footer-email"
                type="email"
                name="email"
                autoComplete="email"
                placeholder={FOOTER_NEWSLETTER.placeholder}
                value={email}
                onChange={event => setEmail(event.target.value)}
              />
              <button type="submit" className="px-footer-subscribe">
                {FOOTER_NEWSLETTER.button}
                <img src={LANDING_ASSETS.chevronRight} alt="" width={20} height={20} aria-hidden />
              </button>
            </form>
            <p className="px-footer-signup-fine">
              {FOOTER_NEWSLETTER.consentPrefix}{' '}
              <Link to={PUBLIC_ROUTES.privacy}>{FOOTER_NEWSLETTER.privacyLabel}</Link>
            </p>
          </div>
        </div>
      </div>

      <div className="px-footer-links-band">
        <div className="px-footer-decor" aria-hidden />
        <div className="px-footer-inner px-footer-inner--wide px-footer-links-row">
          <div className="px-footer-links-aside">
            <div className="px-footer-social">
              <p className="px-footer-overline">{FOOTER_SOCIAL.title}</p>
              <div className="px-footer-social-icons">
                {FOOTER_SOCIAL.items.map(item => (
                  <a
                    key={item.label}
                    href={item.href}
                    className="px-footer-social-link"
                    aria-label={item.label}
                    {...(item.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                  >
                    <img src={item.icon} alt="" width={26} height={26} />
                  </a>
                ))}
              </div>
            </div>
          </div>
          <div className="px-footer-nav-grid">
            {FOOTER_LINK_SECTIONS.map(section => (
              <div key={section.heading} className="px-footer-nav-col">
                <p className="px-footer-overline">{section.heading}</p>
                <div className="px-footer-nav-links">
                  {section.links.map(link => (
                    <FooterLink key={link.label} link={link} storeUrl={storeUrl} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="px-footer-copy-band">
        <p>{FOOTER_COPYRIGHT}</p>
      </div>
    </footer>
  );
}
