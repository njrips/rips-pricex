import type { LoaderFunctionArgs } from "react-router";

/**
 * Crawlers should index the public listing pages (Privacy is required on the App Store).
 * Do not index Admin, OAuth, or webhooks.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const origin = new URL(request.url).origin;
  const body = [
    "User-agent: *",
    "Allow: /",
    "Allow: /privacy",
    "Allow: /terms",
    "Allow: /faq",
    "Allow: /contact",
    "Disallow: /app",
    "Disallow: /auth",
    "Disallow: /webhooks",
    "Disallow: /api",
    `Sitemap: ${origin}/sitemap.xml`,
    "",
  ].join("\n");

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
};
