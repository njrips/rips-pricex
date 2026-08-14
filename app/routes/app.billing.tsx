import type { LoaderFunctionArgs } from 'react-router';
import { redirect } from 'react-router';

/**
 * Legacy Billing route — Plan now lives under Settings.
 * Keep this path for bookmarks, banners, and docs.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const params = new URLSearchParams(url.searchParams);
  params.set('tab', 'plan');
  throw redirect(`/app/settings?${params.toString()}`);
};

export default function BillingRedirect() {
  return null;
}
