import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { consolePathForStaffPath } from "../utils/consoleAuth.server";

// The staff portal became Priceify Console. Ticket emails and bookmarks sent
// before the rename still point here.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  return redirect(consolePathForStaffPath(url.pathname, url.search), 301);
};
