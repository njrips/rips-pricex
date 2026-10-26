import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { Form, Link, useLoaderData } from "react-router";
import { supportErrorMessage } from "../utils/expressSupportApi.server";
import { consoleApiFetch, requireConsoleMember } from "../utils/consoleAuth.server";
import {
  STORE_FILTERS,
  accessLabel,
  formatConsoleDate,
  nextDate,
  normalizeStoreFilter,
  priceLabel,
  storeHref,
  storesHref,
} from "../components/public/priceify/consoleStores";
import { shopHandle } from "../components/public/priceify/staffQueue";

export const meta: MetaFunction = () => [{ title: "Stores · Priceify Console" }];

type StoreRow = {
  shopDomain: string;
  installed: boolean;
  installedAt?: string | null;
  planHandle?: string | null;
  status?: string | null;
  source: string;
  shopifyEntitled: boolean;
  grant?: { expiresAt?: string | null } | null;
  billing?: {
    subscriptionName?: string | null;
    test?: boolean | null;
    trialEndsAt?: string | null;
    currentPeriodEnd?: string | null;
    endedAt?: string | null;
    price?: number | null;
    currency?: string | null;
    interval?: string | null;
    lastAppOpenAt?: string | null;
  } | null;
  runningTests: number;
  openTickets: number;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const member = await requireConsoleMember(request);
  const url = new URL(request.url);
  const filter = normalizeStoreFilter(url.searchParams.get("filter"));
  const q = String(url.searchParams.get("q") || "").trim();
  const params = new URLSearchParams();
  if (filter !== "all") params.set("filter", filter);
  if (q) params.set("q", q);
  const qs = params.toString();
  const res = await consoleApiFetch(member, `/stores${qs ? `?${qs}` : ""}`);
  return {
    stores: (Array.isArray(res.data?.stores) ? res.data.stores : []) as StoreRow[],
    filter,
    q,
    partnerConfigured: Boolean(res.data?.partnerConfigured),
    error: res.ok ? null : supportErrorMessage(res.data, "Could not load stores"),
  };
};

const TONE_CLASS: Record<string, string> = {
  safe: "staff-chip staff-chip--safe",
  brand: "staff-chip staff-chip--brand",
  warn: "staff-chip console-chip--warn",
  muted: "staff-chip staff-chip--muted",
};

function StoreTableRow({ store }: { store: StoreRow }) {
  const access = accessLabel(store);
  const next = nextDate(store);
  const billing = store.billing || {};
  return (
    <tr className="staff-row">
      <td>
        <Link className="staff-row-link" to={storeHref(store.shopDomain)}>
          <span className="staff-ticket-subject">{shopHandle(store.shopDomain)}</span>
          <span className="staff-ticket-cat">{store.shopDomain}</span>
        </Link>
      </td>
      <td>
        <span className={TONE_CLASS[access.tone]}>{access.text}</span>
        {billing.test ? <span className="console-tag">Test charge</span> : null}
      </td>
      <td>
        <span className="console-strong">{billing.subscriptionName || store.planHandle || "—"}</span>
        <span className="console-sub">{priceLabel(billing)}</span>
      </td>
      <td>
        {next.value ? (
          <>
            <span className="console-strong">{formatConsoleDate(next.value)}</span>
            <span className="console-sub">{next.label}</span>
          </>
        ) : (
          "—"
        )}
      </td>
      <td className="console-num">{store.runningTests || "—"}</td>
      <td className="console-num">{store.openTickets || "—"}</td>
      <td>{formatConsoleDate(billing.lastAppOpenAt)}</td>
    </tr>
  );
}

export default function ConsoleStores() {
  const data = useLoaderData<typeof loader>();
  const count = data.stores.length;

  return (
    <section className="staff-panel">
      <div className="staff-panel-head">
        <p className="px-eyebrow">Console</p>
        <h1 className="staff-title">Stores</h1>
        <p className="staff-lead">
          Every store that installed Priceify, its plan, and why it has access. Open a store to see
          its billing history or give support access.
        </p>
      </div>

      <div className="px-card staff-panel-card">
        <div className="staff-chip-row" role="navigation" aria-label="Store filter">
          {STORE_FILTERS.map((chip) => {
            const active = data.filter === chip.value;
            return (
              <Link
                key={chip.value}
                className={active ? "staff-filter-chip is-active" : "staff-filter-chip"}
                to={storesHref({ filter: chip.value, q: data.q })}
                aria-current={active ? "page" : undefined}
              >
                {chip.label}
              </Link>
            );
          })}
        </div>

        <Form method="get" className="staff-filters" key={`${data.filter}|${data.q}`}>
          {data.filter !== "all" ? <input type="hidden" name="filter" value={data.filter} /> : null}
          <label className="staff-label" htmlFor="store-q">
            Store
            <input
              id="store-q"
              className="staff-input"
              name="q"
              defaultValue={data.q}
              autoComplete="off"
              placeholder="ripx-plus or shop.myshopify.com"
            />
          </label>
          <button className="px-btn px-btn--brand" type="submit">
            Search
          </button>
        </Form>

        {data.error ? (
          <p className="staff-error" role="alert">
            {data.error}
          </p>
        ) : (
          <p className="staff-result-count">{count === 1 ? "1 store" : `${count} stores`}</p>
        )}
        {!data.partnerConfigured ? (
          <p className="staff-hint">
            Dates come from app opens and Shopify webhooks. The daily Partner API check is off until
            its keys are set on the server.
          </p>
        ) : null}

        <div className="staff-table-wrap">
          <table className="staff-table console-table">
            <caption className="staff-visually-hidden">Stores</caption>
            <thead>
              <tr>
                <th>Store</th>
                <th>Access</th>
                <th>Plan</th>
                <th>Next date</th>
                <th>Running tests</th>
                <th>Open tickets</th>
                <th>Last app open</th>
              </tr>
            </thead>
            <tbody>
              {count === 0 ? (
                <tr>
                  <td colSpan={7} className="staff-empty">
                    {data.q || data.filter !== "all"
                      ? "No stores match this filter."
                      : "No stores have installed Priceify yet."}
                  </td>
                </tr>
              ) : (
                data.stores.map((store) => <StoreTableRow key={store.shopDomain} store={store} />)
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
