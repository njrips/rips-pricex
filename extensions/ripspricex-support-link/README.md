# Support link

Redirects Shopify Admin **Get support** to the embedded Help page (`/app/help`).

Do not set `text` on `[[extensions.targeting]]`. Shopify CLI rejects that property on `admin_link`.

Deploy with `shopify app deploy` so the link is live in production. `shopify app dev` is enough to test locally.
