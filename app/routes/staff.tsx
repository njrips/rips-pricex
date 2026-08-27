import type { HeadersFunction, LoaderFunctionArgs, MetaFunction } from "react-router";
import {
  Link,
  Outlet,
  isRouteErrorResponse,
  redirect,
  useLoaderData,
  useLocation,
  useRouteError,
} from "react-router";
import StaffPricifyShell from "../components/public/pricify/StaffPricifyShell";
import { requireStaffSession, safeStaffNext } from "../utils/staffSupportAuth.server";

export const meta: MetaFunction = () => [
  { title: "Staff · Pricify" },
  { name: "robots", content: "noindex, nofollow" },
];

export const headers: HeadersFunction = () => ({
  "X-Robots-Tag": "noindex, nofollow",
  "Cache-Control": "no-store",
});

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const isLogin = url.pathname === "/staff/login" || url.pathname === "/staff/login/";
  const authed = requireStaffSession(request);
  if (!authed && !isLogin) {
    const next = encodeURIComponent(`${url.pathname}${url.search}`);
    throw redirect(`/staff/login?next=${next}`);
  }
  if (authed && isLogin) {
    throw redirect(safeStaffNext(url.searchParams.get("next")));
  }
  return { authed };
};

export default function StaffLayout() {
  const { authed } = useLoaderData<typeof loader>();
  const { pathname } = useLocation();
  const isLogin = pathname === "/staff/login" || pathname === "/staff/login/";

  return (
    <StaffPricifyShell
      showQueueNav={authed && !isLogin}
      wide={!isLogin}
      homeTo={authed && !isLogin ? '/staff/support' : '/'}
    >
      <Outlet />
    </StaffPricifyShell>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error)
    ? error.statusText || `Request failed (${error.status})`
    : "Staff support hit an error. Try signing in again.";

  return (
    <StaffPricifyShell>
      <section className="staff-auth">
        <div className="px-card staff-auth-card">
          <p className="px-eyebrow">Staff</p>
          <h1 className="staff-title">Something went wrong</h1>
          <p className="staff-error" role="alert">
            {message}
          </p>
          <Link className="px-btn px-btn--brand" to="/staff/login" reloadDocument>
            Back to staff login
          </Link>
        </div>
      </section>
    </StaffPricifyShell>
  );
}
