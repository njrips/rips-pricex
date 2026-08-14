import type { LoaderFunctionArgs } from "react-router";
import { PUBLIC_ROUTES } from "../constants/publicRoutes";

const PATHS = [
  PUBLIC_ROUTES.home,
  PUBLIC_ROUTES.privacy,
  PUBLIC_ROUTES.terms,
  PUBLIC_ROUTES.faq,
  PUBLIC_ROUTES.contact,
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const origin = new URL(request.url).origin;
  const urls = PATHS.map(
    (path) =>
      `  <url><loc>${origin}${path === "/" ? "/" : path}</loc><changefreq>monthly</changefreq></url>`
  ).join("\n");

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;

  return new Response(body, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
};
