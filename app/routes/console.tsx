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
import ConsoleShell from "../components/public/priceify/ConsoleShell";
import { PUBLIC_ROUTES } from "../constants/publicRoutes";
import { getConsoleMember, safeConsoleNext } from "../utils/consoleAuth.server";

const CONSOLE_SIGN_IN_PATH = PUBLIC_ROUTES.console;

export const meta: MetaFunction = () => [
  { title: "Priceify Console" },
  { name: "robots", content: "noindex, nofollow" },
];

export const headers: HeadersFunction = () => ({
  "X-Robots-Tag": "noindex, nofollow",
  "Cache-Control": "no-store",
});

function isSignInPath(pathname: string) {
  return pathname === CONSOLE_SIGN_IN_PATH || pathname === `${CONSOLE_SIGN_IN_PATH}/`;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const signingIn = isSignInPath(url.pathname);
  const member = await getConsoleMember(request);
  if (!member && !signingIn) {
    const next = encodeURIComponent(`${url.pathname}${url.search}`);
    throw redirect(`${CONSOLE_SIGN_IN_PATH}?next=${next}`);
  }
  if (member && signingIn) {
    throw redirect(safeConsoleNext(url.searchParams.get("next")));
  }
  return {
    member: member
      ? { email: member.email, displayName: member.displayName, role: member.role }
      : null,
  };
};

export default function ConsoleLayout() {
  const { member } = useLoaderData<typeof loader>();
  const { pathname } = useLocation();
  const signingIn = isSignInPath(pathname);

  return (
    <ConsoleShell
      member={signingIn ? null : member}
      wide={!signingIn}
      homeTo={member && !signingIn ? "/console/tickets" : "/"}
    >
      <Outlet />
    </ConsoleShell>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error)
    ? error.statusText || `Request failed (${error.status})`
    : "Priceify Console hit an error. Try signing in again.";

  return (
    <ConsoleShell>
      <section className="staff-auth">
        <div className="px-card staff-auth-card">
          <p className="px-eyebrow">Console</p>
          <h1 className="staff-title">Something went wrong</h1>
          <p className="staff-error" role="alert">
            {message}
          </p>
          <Link className="px-btn px-btn--brand" to={CONSOLE_SIGN_IN_PATH} reloadDocument>
            Back to sign-in
          </Link>
        </div>
      </section>
    </ConsoleShell>
  );
}
