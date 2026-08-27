import { Link } from 'react-router';
import { PUBLIC_ROUTES } from '../../../constants/publicRoutes';
import { DEFAULT_APP_STORE_LISTING_URL } from '../../../utils/appStoreListingUrl';
import PublicSectionLink from './PublicSectionLink';

export default function ContactPage({ storeUrl, supportEmail = '' }) {
  return (
    <article className="docCard">
      <Link to={PUBLIC_ROUTES.home} className="backLink">
        Back to Pricify
      </Link>
      <p className="eyebrow">COMPANY</p>
      <h1 className="title">Contact</h1>
      <p className="subtitle">
        Pricing experimentation for Shopify merchants. Test before you change.
      </p>
      <p className="docBody">
        If the app is already installed, open Help from Shopify Admin (Get support) so we get shop
        diagnostics and a ticket id. This page is for before install, or after uninstall.
      </p>
      {supportEmail ? (
        <p className="docBody">
          Email{' '}
          <a className="textLink" href={`mailto:${supportEmail}`}>
            {supportEmail}
          </a>
          .
        </p>
      ) : (
        <p className="docBody">Use the developer contact on the Shopify App Store listing.</p>
      )}
      <p className="docBody">
        <a
          className="px-btn px-btn--brand"
          href={storeUrl || DEFAULT_APP_STORE_LISTING_URL}
          target="_top"
          rel="noopener noreferrer"
        >
          Install free on Shopify →
        </a>
      </p>
      <p className="docBody">
        <PublicSectionLink hash="faq" className="textLink">
          FAQ
        </PublicSectionLink>
        {' · '}
        <Link to={PUBLIC_ROUTES.privacy} className="textLink">
          Privacy Policy
        </Link>
        {' · '}
        <Link to={PUBLIC_ROUTES.terms} className="textLink">
          Terms of Service
        </Link>
      </p>
    </article>
  );
}
