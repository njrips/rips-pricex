import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";
import { useEffect, useState } from "react";
import { Form, Link, redirect, useActionData, useLoaderData, useNavigation } from "react-router";
import { shopHandle, staffQueueBackHref } from "../components/public/pricify/staffQueue";
import { useHydrated } from "../hooks/useHydrated";
import { expressSupportFetch, supportErrorMessage } from "../utils/expressSupportApi.server";
import { staffToken } from "../utils/staffSupportAuth.server";
import {
  formatTicketTime,
  isPublicIdFormat,
  ticketCategoryLabel,
  ticketStatusLabel,
} from "../components/SmartPricing/classic/helpFaq";
import { summarizeDiagnostics } from "../utils/supportDiagnostics.server";

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  {
    title: data?.ticket?.public_id
      ? `${data.ticket.public_id} · Staff · Pricify`
      : "Ticket · Staff · Pricify",
  },
];

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const publicId = String(params.ticketId || "").trim();
  if (!isPublicIdFormat(publicId)) {
    return { ticket: null, diagnosticRows: [], error: "Invalid ticket id", notice: null };
  }
  const res = await expressSupportFetch(`/staff/support/tickets/${encodeURIComponent(publicId)}`, {
    staffToken: staffToken(),
  });
  if (!res.ok) {
    return {
      ticket: null,
      diagnosticRows: [],
      error: supportErrorMessage(res.data, "Ticket not found"),
      notice: null,
    };
  }
  const search = new URL(request.url).searchParams;
  const notice =
    search.get("sent") === "1"
      ? "Reply sent"
      : search.get("updated") === "1"
        ? "Status updated"
        : null;
  const ticket = res.data?.ticket || null;
  return {
    ticket,
    diagnosticRows: ticket ? summarizeDiagnostics(ticket.diagnostics) : [],
    error: null,
    notice,
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const publicId = String(params.ticketId || "").trim();
  if (!isPublicIdFormat(publicId)) {
    return { error: "Invalid ticket id" };
  }
  const form = await request.formData();
  const intent = String(form.get("intent") || "reply");
  const token = staffToken();

  if (intent === "status") {
    const res = await expressSupportFetch(`/staff/support/tickets/${encodeURIComponent(publicId)}`, {
      staffToken: token,
      method: "PATCH",
      body: { status: String(form.get("status") || "") },
    });
    if (!res.ok) return { error: supportErrorMessage(res.data, "Could not update status") };
    return redirect(`/staff/support/${encodeURIComponent(publicId)}?updated=1`);
  }

  const body = String(form.get("body") || "").trim();
  if (!body) return { error: "Enter a reply." };
  const res = await expressSupportFetch(
    `/staff/support/tickets/${encodeURIComponent(publicId)}/messages`,
    {
      staffToken: token,
      method: "POST",
      body: { body },
    },
  );
  if (!res.ok) return { error: supportErrorMessage(res.data, "Could not send reply") };
  return redirect(`/staff/support/${encodeURIComponent(publicId)}?sent=1`);
};

export default function StaffTicketDetail() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const ticket = data.ticket;
  const closed = ticket?.status === "closed";
  const [reply, setReply] = useState("");
  // The remembered queue filters live in browser storage, so the back link can
  // only resolve to them after hydration; before that both sides render the
  // plain queue href.
  const hydrated = useHydrated();
  const backTo = hydrated ? staffQueueBackHref() : "/staff/support";

  useEffect(() => {
    if (!data.notice || typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (!url.searchParams.has("sent") && !url.searchParams.has("updated")) return;
    url.searchParams.delete("sent");
    url.searchParams.delete("updated");
    const next = `${url.pathname}${url.search}`;
    window.history.replaceState({}, "", next);
  }, [data.notice]);

  if (!ticket) {
    return (
      <section className="staff-panel">
        <div className="px-card staff-panel-card">
          <p className="staff-error" role="alert">
            {data.error || "Ticket not found"}
          </p>
          <Link className="px-btn px-btn--ghost" to={backTo}>
            Back to queue
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="staff-panel">
      <div className="staff-panel-head">
        <Link className="backLink" to={backTo}>
          Queue
        </Link>
        <p className="px-eyebrow">{ticket.public_id}</p>
        <h1 className="staff-title">{ticket.subject}</h1>
        <p className="staff-lead">
          <span title={ticket.shop_domain}>{shopHandle(ticket.shop_domain) || ticket.shop_domain}</span> · {ticketCategoryLabel(ticket.category)} ·{" "}
          {ticketStatusLabel(ticket.status, { staff: true })}
          {ticket.reply_email ? ` · ${ticket.reply_email}` : ""}. Reply is visible only in that
          shop’s Admin Help.
        </p>
      </div>

      <div className="px-card staff-panel-card">
        {actionData?.error ? (
          <p className="staff-error" role="alert">
            {actionData.error}
          </p>
        ) : null}
        {data.notice ? (
          <p className="staff-success" aria-live="polite">
            {data.notice}
          </p>
        ) : null}

        <div className="staff-thread">
          {(ticket.messages || []).length === 0 ? (
            <p className="staff-empty">No messages on this thread yet.</p>
          ) : null}
          {(ticket.messages || []).map(
            (message: { id: string; author: string; body: string; created_at: string }) => (
              <div
                className={message.author === "staff" ? "staff-msg staff-msg--staff" : "staff-msg"}
                key={message.id}
              >
                <div className="meta">
                  {message.author === "staff" ? "Staff" : "Merchant"} ·{" "}
                  {formatTicketTime(message.created_at)}
                </div>
                <div className="staff-msg-body">{message.body}</div>
              </div>
            ),
          )}
        </div>

        {closed ? (
          <Form method="post" className="staff-form">
            <input type="hidden" name="intent" value="status" />
            <input type="hidden" name="status" value="open" />
            <p className="staff-hint">This ticket is closed. Reopen it before replying.</p>
            <button className="px-btn px-btn--ghost" type="submit" disabled={busy}>
              {busy && navigation.formData?.get("intent") === "status" ? "Updating…" : "Reopen ticket"}
            </button>
          </Form>
        ) : (
          <Form method="post" className="staff-form">
            <input type="hidden" name="intent" value="reply" />
            <label className="staff-label" htmlFor="reply">
              Reply
              <textarea
                id="reply"
                className="staff-input"
                name="body"
                rows={5}
                required
                disabled={busy}
                value={reply}
                onChange={(event) => setReply(event.target.value)}
                placeholder="Reply is visible only in that shop’s Admin Help."
              />
            </label>
            <button
              className="px-btn px-btn--brand"
              type="submit"
              disabled={busy || !reply.trim()}
            >
              {busy && navigation.formData?.get("intent") === "reply" ? "Sending…" : "Send reply"}
            </button>
          </Form>
        )}

        <Form method="post" className="staff-filters staff-filters--status">
          <input type="hidden" name="intent" value="status" />
          <label className="staff-label" htmlFor="status">
            Status
            <select
              id="status"
              className="staff-input"
              name="status"
              defaultValue={ticket.status}
              key={`${ticket.public_id}:${ticket.status}`}
            >
              <option value="open">{ticketStatusLabel("open", { staff: true })}</option>
              <option value="waiting_staff">
                {ticketStatusLabel("waiting_staff", { staff: true })}
              </option>
              <option value="waiting_merchant">
                {ticketStatusLabel("waiting_merchant", { staff: true })}
              </option>
              <option value="resolved">{ticketStatusLabel("resolved", { staff: true })}</option>
              <option value="closed">{ticketStatusLabel("closed", { staff: true })}</option>
            </select>
          </label>
          <button className="px-btn px-btn--ghost" type="submit" disabled={busy}>
            {busy && navigation.formData?.get("intent") === "status" ? "Updating…" : "Update status"}
          </button>
        </Form>

        <h2 className="staff-section-title">Diagnostics</h2>
        {data.diagnosticRows.length ? (
          <dl className="staff-dl">
            {data.diagnosticRows.map(([label, value]: [string, string]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="staff-hint">No shop diagnostics on this ticket.</p>
        )}
        <details className="staff-raw">
          <summary>Raw diagnostics</summary>
          <pre className="staff-pre">{JSON.stringify(ticket.diagnostics || {}, null, 2)}</pre>
        </details>
      </div>
    </section>
  );
}
