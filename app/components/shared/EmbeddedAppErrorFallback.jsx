import { Link } from 'react-router';
import { AppProvider } from '@shopify/shopify-app-react-router/react';
import { AppProvider as PolarisAppProvider, Banner, Button } from '@shopify/polaris';
import enTranslations from '@shopify/polaris/locales/en.json';
import { resolveShopifyApiKey } from '../../utils/themeEmbedUrl';

function EmbeddedShell({ children }) {
  return (
    <AppProvider embedded apiKey={resolveShopifyApiKey()}>
      <PolarisAppProvider i18n={enTranslations}>
        <div data-palette="admin" className="page">
          {children}
        </div>
      </PolarisAppProvider>
    </AppProvider>
  );
}

/** Shown while RR / App Bridge finishes a redirect instead of "Handling response". */
export function EmbeddedAppLoadingFallback({ label = 'Loading…' }) {
  return (
    <EmbeddedShell>
      <div
        className="rpx-route-loading__panel"
        style={{ margin: '48px auto' }}
        aria-busy="true"
        aria-live="polite"
      >
        <div className="rpx-route-loading__spinner" aria-hidden />
        <p className="rpx-route-loading__label">{label}</p>
      </div>
    </EmbeddedShell>
  );
}

export function EmbeddedAppErrorFallback({
  title = 'Something went wrong',
  message = 'Try opening Tests again. If this keeps happening, refresh the app from Shopify Admin.',
}) {
  return (
    <EmbeddedShell>
      <div style={{ maxWidth: 560, margin: '32px auto', padding: '0 16px' }}>
        <Banner tone="critical" title={title}>
          <p>{message}</p>
        </Banner>
        <div style={{ marginTop: 16 }}>
          <Link to="/app">
            <Button>Back to tests</Button>
          </Link>
        </div>
      </div>
    </EmbeddedShell>
  );
}
