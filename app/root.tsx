import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
import type { LinksFunction } from "react-router";

import adminTokensHref from "./styles/admin-polaris-tokens.css?url";
import classicThemeHref from "./styles/classic-theme.css?url";
import publicClassicHref from "./styles/public-classic.css?url";
import staffSupportHref from "./styles/staff-support.css?url";

/** Bump when favicon art changes so browsers pick up the new tab icon. */
const FAVICON_VERSION = "2";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: adminTokensHref },
  { rel: "stylesheet", href: classicThemeHref },
  { rel: "stylesheet", href: publicClassicHref },
  { rel: "stylesheet", href: staffSupportHref },
  { rel: "icon", type: "image/svg+xml", href: `/favicon.svg?v=${FAVICON_VERSION}` },
  {
    rel: "icon",
    type: "image/svg+xml",
    href: `/priceify/favicon.svg?v=${FAVICON_VERSION}`,
  },
  {
    rel: "apple-touch-icon",
    sizes: "180x180",
    href: `/priceify/apple-touch-icon.png?v=${FAVICON_VERSION}`,
  },
];

export default function App() {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <link
          rel="stylesheet"
          href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
        />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap"
        />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0,0&display=swap"
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
