import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
import type { LinksFunction } from "react-router";

import adminTokensHref from "./styles/admin-polaris-tokens.css?url";
import classicThemeHref from "./styles/classic-theme.css?url";
import publicClassicHref from "./styles/public-classic.css?url";
import staffSupportHref from "./styles/staff-support.css?url";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: adminTokensHref },
  { rel: "stylesheet", href: classicThemeHref },
  { rel: "stylesheet", href: publicClassicHref },
  { rel: "stylesheet", href: staffSupportHref },
];

export default function App() {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link rel="icon" type="image/svg+xml" href="/priceify/favicon.svg" />
        <link rel="apple-touch-icon" href="/priceify/favicon.svg" />
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <link
          rel="stylesheet"
          href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
        />
        <Meta />
        <Links />
      </head>
      <body suppressHydrationWarning>
        <Outlet />
        <ScrollRestoration
          getKey={(location) =>
            location.pathname === "/" ? location.pathname : location.key
          }
        />
        <Scripts />
      </body>
    </html>
  );
}
