import { useEffect, useMemo, type FormEvent } from "react";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { Form, Link, useLoaderData } from "react-router";
import { expressSupportFetch, supportErrorMessage } from "../utils/expressSupportApi.server";
import { staffToken } from "../utils/staffSupportAuth.server";
import {
  formatTicketTime,
  ticketCategoryLabel,
  ticketStatusLabel,
} from "../components/SmartPricing/classic/helpFaq";
import {
  DEFAULT_QUEUE_SORT,
  DEFAULT_QUEUE_STATUS,
  QUEUE_PAGE_LIMIT,
  clipPreview,
  countNeedsYou,
  emptyQueueMessage,
  expandShopFilter,
  formatRelativeTicketTime,
  latestAuthorLabel,
  normalizeQueueSort,
  queueHref,
  shopHandle,
  sortStaffTickets,
  staffNeedsYou,
  staffRowTone,
  ticketDateTime,
  ticketHref,
  usingQueueFilters,
  writeStaffQueueFilters,
} from "../components/public/priceify/staffQueue";

export const meta: MetaFunction = () => [{ title: "Ticket queue · Staff · Priceify" }];

const STATUS_CHIPS = [
  { value: DEFAULT_QUEUE_STATUS, label: "Needs attention" },
  { value: "waiting_staff", label: "Waiting on you" },
  { value: "waiting_merchant", label: "Waiting on merchant" },
  { value: "open", label: "Open" },
  { value: "resolved", label: "Resolved" },
  { value: "closed", label: "Closed" },
  { value: "", label: "All" },
];

const SORTS = [
  { value: "updated", label: "Newest" },
  { value: "need", label: "Needs you" },
  { value: "shop", label: "Shop" },
  { value: "status", label: "Status" },
];

function statusChipClass(status: string) {
  if (status === "resolved" || status === "closed") return "staff-chip staff-chip--safe";
  if (status === "waiting_merchant") return "staff-chip staff-chip--muted";
  return "staff-chip staff-chip--brand";
}

type StaffTicketRow = {
  public_id: string;
  shop_domain: string;
  subject: string;
  category: string;
  status: string;
  last_message_preview?: string;
  last_message_author?: string;
  updated_at?: string;
};

function QueueTicketRow({ ticket }: { ticket: StaffTicketRow }) {
  const href = ticketHref(ticket.public_id);
  const tone = staffRowTone(ticket.status, ticket.updated_at);
  const latest = clipPreview(ticket.last_message_preview);
  const author = latestAuthorLabel(ticket.last_message_author);
  const when = formatRelativeTicketTime(ticket.updated_at);
  const exact = formatTicketTime(ticket.updated_at);
  const iso = ticketDateTime(ticket.updated_at);

  return (
    <tr className={`staff-row staff-row--${tone}`}>
      <td>
        <Link className="staff-row-link" to={href}>
          <span className="staff-ticket-id">{ticket.public_id}</span>
          <span className="staff-ticket-subject">{ticket.subject}</span>
          <span className="staff-ticket-cat">{ticketCategoryLabel(ticket.category)}</span>
        </Link>
      </td>
      <td>
        <span className="staff-shop" title={ticket.shop_domain}>
          {shopHandle(ticket.shop_domain)}
        </span>
      </td>
      <td>
        <span className={statusChipClass(ticket.status)}>
          {ticketStatusLabel(ticket.status, { staff: true })}
        </span>
        {staffNeedsYou(ticket.status) ? <span className="staff-need-dot">Needs you</span> : null}
      </td>
      <td className="staff-latest">
        {latest ? (
          <>
            {author ? <span className="staff-latest-author">{author}</span> : null}
            {latest}
          </>
        ) : (
          "—"
        )}
      </td>
      <td>
        <time className="staff-when" dateTime={iso || undefined} title={exact || undefined}>
          {when}
        </time>
      </td>
    </tr>
  );
}

function QueueTicketCard({ ticket }: { ticket: StaffTicketRow }) {
  const href = ticketHref(ticket.public_id);
  const tone = staffRowTone(ticket.status, ticket.updated_at);
  const latest = clipPreview(ticket.last_message_preview, 120);
  const author = latestAuthorLabel(ticket.last_message_author);
  const iso = ticketDateTime(ticket.updated_at);

  return (
    <article className={`staff-queue-card staff-row--${tone}`}>
      <Link className="staff-queue-card-link" to={href}>
        <div className="staff-queue-card-top">
          <span className="staff-ticket-id">{ticket.public_id}</span>
          <time
            className="staff-when"
            dateTime={iso || undefined}
            title={formatTicketTime(ticket.updated_at) || undefined}
          >
            {formatRelativeTicketTime(ticket.updated_at)}
          </time>
        </div>
        <h3 className="staff-ticket-subject">{ticket.subject}</h3>
        <p className="staff-queue-card-meta">
          {shopHandle(ticket.shop_domain)} · {ticketCategoryLabel(ticket.category)}
        </p>
        {latest ? (
          <p className="staff-latest">
            {author ? <span className="staff-latest-author">{author}</span> : null}
            {latest}
          </p>
        ) : null}
        <div className="staff-queue-card-status">
          <span className={statusChipClass(ticket.status)}>
            {ticketStatusLabel(ticket.status, { staff: true })}
          </span>
          {staffNeedsYou(ticket.status) ? <span className="staff-need-dot">Needs you</span> : null}
        </div>
      </Link>
    </article>
  );
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const status = url.searchParams.has("status")
    ? url.searchParams.get("status") || ""
    : DEFAULT_QUEUE_STATUS;
  const shop = url.searchParams.get("shop") || "";
  const q = url.searchParams.get("q") || "";
  const sort = normalizeQueueSort(url.searchParams.get("sort"));
  const qs = new URLSearchParams();
  if (status) qs.set("status", status);
  if (shop) qs.set("shop", expandShopFilter(shop));
  if (q) qs.set("q", q);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";

  const res = await expressSupportFetch(`/staff/support/tickets${suffix}`, {
    staffToken: staffToken(),
  });
  return {
    tickets: sortStaffTickets(Array.isArray(res.data?.tickets) ? res.data.tickets : [], sort),
    status,
    shop,
    q,
    sort,
    error: res.ok ? null : supportErrorMessage(res.data, "Could not load tickets"),
  };
};

function dropEmptyQueueFields(event: FormEvent<HTMLFormElement>) {
  const form = event.currentTarget;
  for (const name of ["shop", "q"] as const) {
    const field = form.elements.namedItem(name);
    if (field instanceof HTMLInputElement && !field.value.trim()) field.removeAttribute("name");
  }
  const sort = form.elements.namedItem("sort");
  if (sort instanceof HTMLInputElement && normalizeQueueSort(sort.value) === DEFAULT_QUEUE_SORT) {
    sort.removeAttribute("name");
  }
}

export default function StaffSupportQueue() {
  const data = useLoaderData<typeof loader>();
  const usingFilters = usingQueueFilters(data);
  const ticketCount = data.tickets.length;
  const needCount = countNeedsYou(data.tickets);
  const filters = useMemo(
    () => ({ status: data.status, shop: data.shop, q: data.q, sort: data.sort }),
    [data.status, data.shop, data.q, data.sort]
  );
  const emptyCopy = emptyQueueMessage(data);

  useEffect(() => {
    writeStaffQueueFilters(filters);
  }, [filters]);

  return (
    <section className="staff-panel">
      <div className="staff-panel-head">
        <p className="px-eyebrow">Staff</p>
        <h1 className="staff-title">Ticket queue</h1>
        <p className="staff-lead">
          Open a row to reply. That thread is only visible to that shop in Admin Help — you cannot
          open Shopify Admin as the merchant.
        </p>
      </div>

      <div className="px-card staff-panel-card">
        <div className="staff-chip-row" role="navigation" aria-label="Queue status">
          {STATUS_CHIPS.map((chip) => {
            const href = queueHref({ ...filters, status: chip.value, sort: data.sort });
            const active = data.status === chip.value;
            return (
              <Link
                key={chip.label}
                className={active ? "staff-filter-chip is-active" : "staff-filter-chip"}
                to={href}
                aria-current={active ? "page" : undefined}
              >
                {chip.label}
              </Link>
            );
          })}
        </div>

        <Form
          method="get"
          className="staff-filters"
          key={`${data.status}|${data.shop}|${data.q}|${data.sort}`}
          onSubmit={dropEmptyQueueFields}
        >
          <input type="hidden" name="status" value={data.status} />
          <input type="hidden" name="sort" value={data.sort} />
          <label className="staff-label" htmlFor="shop">
            Shop
            <input
              id="shop"
              className="staff-input"
              name="shop"
              defaultValue={data.shop}
              autoComplete="off"
              placeholder="ripx-plus or shop.myshopify.com"
            />
          </label>
          <label className="staff-label" htmlFor="q">
            Search
            <input
              id="q"
              className="staff-input"
              name="q"
              defaultValue={data.q}
              autoComplete="off"
              placeholder="PX-7K2M, shop, or subject"
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
          <div className="staff-result-row">
            <p className="staff-result-count">
              {ticketCount === 1 ? "1 ticket" : `${ticketCount} tickets`}
              {needCount ? ` · ${needCount} need you` : ""}
              {usingFilters ? " · filtered" : ""}
              {ticketCount >= QUEUE_PAGE_LIMIT ? ` · latest ${QUEUE_PAGE_LIMIT}` : ""}
            </p>
            <div className="staff-sort">
              <span className="staff-sort-label">Sort</span>
              {SORTS.map((item) => (
                <Link
                  key={item.value}
                  className={data.sort === item.value ? "staff-sort-link is-active" : "staff-sort-link"}
                  to={queueHref({ ...filters, sort: item.value })}
                  aria-current={data.sort === item.value ? "true" : undefined}
                >
                  {item.label}
                </Link>
              ))}
              {usingFilters ? (
                <Link className="staff-clear-filters" to="/staff/support">
                  Clear
                </Link>
              ) : null}
            </div>
          </div>
        )}

        {ticketCount >= QUEUE_PAGE_LIMIT ? (
          <p className="staff-hint">
            Showing the latest {QUEUE_PAGE_LIMIT} in this filter. Narrow shop or search to find an
            older ticket.
          </p>
        ) : null}

        <div className="staff-table-wrap staff-table-wrap--desktop">
          <table className="staff-table">
            <caption className="staff-visually-hidden">Staff ticket queue</caption>
            <thead>
              <tr>
                <th>Conversation</th>
                <th>Shop</th>
                <th>Status</th>
                <th>Latest</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {data.tickets.length === 0 ? (
                <tr>
                  <td colSpan={5} className="staff-empty">
                    {emptyCopy}
                    {data.shop && data.status === DEFAULT_QUEUE_STATUS ? (
                      <>
                        {" "}
                        <Link className="staff-clear-filters" to={queueHref({ ...filters, status: "" })}>
                          View all for this shop
                        </Link>
                      </>
                    ) : null}
                  </td>
                </tr>
              ) : (
                data.tickets.map((ticket: StaffTicketRow) => (
                  <QueueTicketRow key={ticket.public_id} ticket={ticket} />
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="staff-queue-cards">
          {data.tickets.length === 0 ? (
            <p className="staff-empty">
              {emptyCopy}
              {data.shop && data.status === DEFAULT_QUEUE_STATUS ? (
                <>
                  {" "}
                  <Link className="staff-clear-filters" to={queueHref({ ...filters, status: "" })}>
                    View all for this shop
                  </Link>
                </>
              ) : null}
            </p>
          ) : (
            data.tickets.map((ticket: StaffTicketRow) => (
              <QueueTicketCard key={ticket.public_id} ticket={ticket} />
            ))
          )}
        </div>
      </div>
    </section>
  );
}
