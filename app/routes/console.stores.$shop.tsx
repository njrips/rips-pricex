import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";
import {
  Form,
  Link,
  redirect,
  useActionData,
  useLoaderData,
  useNavigation,
  useRouteLoaderData,
} from "react-router";
import { supportErrorMessage } from "../utils/expressSupportApi.server";
import {
  assertSameOrigin,
  consoleApiFetch,
  requireConsoleMember,
} from "../utils/consoleAuth.server";
import {
  accessLabel,
  billingEventLabel,
  billingSourceLabel,
  consoleActionLabel,
  formatConsoleDate,
  formatConsoleDateTime,
  priceLabel,
  storeHref,
} from "../components/public/priceify/consoleStores";
import { shopHandle, ticketHref } from "../components/public/priceify/staffQueue";
import { ticketStatusLabel } from "../components/SmartPricing/classic/helpFaq";
import type { loader as consoleLoader } from "./console";

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  {
    title: data?.store?.shopDomain
      ? `${shopHandle(data.store.shopDomain)} · Stores · Priceify Console`
      : "Store · Priceify Console",
  },
];

type Grant = {
  id: number;
  reason: string;
  startsAt: string;
  expiresAt: string;
  grantedBy: string;
  revokedAt?: string | null;
  revokedBy?: string | null;
  revokeReason?: string | null;
  createdAt: string;
};

const NOTICES: Record<string, string> = {
  refreshed: "Refreshed from Shopify.",
  granted: "Support access given.",
  extended: "Support access extended.",
  revoked: "Support access ended.",
};

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const member = await requireConsoleMember(request);
  const shop = String(params.shop || "").trim().toLowerCase();
  const res = await consoleApiFetch(member, `/stores/${encodeURIComponent(shop)}`);
  const done = new URL(request.url).searchParams.get("done") || "";
  if (!res.ok) {
    return { store: null, error: supportErrorMessage(res.data, "Store not found"), notice: null } as const;
  }
  return {
    ...res.data,
    grants: (res.data.grants || []) as Grant[],
    error: null,
    notice: NOTICES[done] || null,
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  assertSameOrigin(request);
  const member = await requireConsoleMember(request);
  const shop = String(params.shop || "").trim().toLowerCase();
  const form = await request.formData();
  const intent = String(form.get("intent") || "");
  const back = (done: string) => redirect(`${storeHref(shop)}?done=${done}`);

  if (intent === "refresh") {
    const res = await consoleApiFetch(member, `/stores/${encodeURIComponent(shop)}/refresh`, {
      method: "POST",
      body: {},
      request,
    });
    return res.ok ? back("refreshed") : { error: supportErrorMessage(res.data, "Refresh failed") };
  }
  if (intent === "grant") {
    const res = await consoleApiFetch(member, `/stores/${encodeURIComponent(shop)}/support-access`, {
      method: "POST",
      body: { days: Number(form.get("days")), reason: String(form.get("reason") || "") },
      request,
    });
    return res.ok
      ? back("granted")
      : { error: supportErrorMessage(res.data, "Could not give support access") };
  }
  if (intent === "extend" || intent === "revoke") {
    const id = Number(form.get("grantId"));
    const res = await consoleApiFetch(member, `/support-access/${id}`, {
      method: "PATCH",
      body:
        intent === "revoke"
          ? { revoke: true, reason: String(form.get("reason") || "") }
          : { days: Number(form.get("days")) },
      request,
    });
    return res.ok
      ? back(intent === "revoke" ? "revoked" : "extended")
      : { error: supportErrorMessage(res.data, "Could not change support access") };
  }
  return { error: "Choose an action." };
};

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function DaysSelect({ options, name = "days", id }: { options: number[]; name?: string; id: string }) {
  return (
    <select id={id} className="staff-input" name={name} defaultValue={String(options.includes(7) ? 7 : options[0])}>
      {options.map((days) => (
        <option key={days} value={days}>
          {days === 1 ? "1 day" : `${days} days`}
        </option>
      ))}
    </select>
  );
}

export default function ConsoleStoreDetail() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const layout = useRouteLoaderData<typeof consoleLoader>("routes/console");
  const isOwner = layout?.member?.role === "owner";
  const busy = navigation.state !== "idle";
  const busyIntent = String(navigation.formData?.get("intent") || "");

  if (!data.store) {
    return (
      <section className="staff-panel">
        <div className="px-card staff-panel-card">
          <p className="staff-error" role="alert">
            {data.error}
          </p>
          <Link className="px-btn px-btn--ghost" to="/console/stores">
            Back to stores
          </Link>
        </div>
      </section>
    );
  }

  const store = data.store;
  const billing = store.billing || {};
  const access = accessLabel(store);
  const current: Grant | null = store.grant ? (data.grants.find((g: Grant) => g.id === store.grant.id) || store.grant) : null;
  const dayOptions: number[] = data.grantDayOptions || [1, 3, 7, 14, 30];

  return (
    <section className="staff-panel">
      <div className="staff-panel-head">
        <Link className="backLink" to="/console/stores">
          ← Stores
        </Link>
        <p className="px-eyebrow">Store</p>
        <h1 className="staff-title">{shopHandle(store.shopDomain)}</h1>
        <p className="staff-lead">
          {store.shopDomain} ·{" "}
          <span className={`staff-chip ${access.tone === "safe" ? "staff-chip--safe" : access.tone === "brand" ? "staff-chip--brand" : access.tone === "warn" ? "console-chip--warn" : "staff-chip--muted"}`}>
            {access.text}
          </span>
        </p>
      </div>

      {actionData && "error" in actionData && actionData.error ? (
        <p className="staff-error" role="alert">
          {actionData.error}
        </p>
      ) : null}
      {data.notice ? (
        <p className="staff-success" aria-live="polite">
          {data.notice}
        </p>
      ) : null}

      <div className="px-card staff-panel-card">
        <div className="console-card-head">
          <h2 className="staff-section-title">Billing</h2>
          <Form method="post">
            <input type="hidden" name="intent" value="refresh" />
            <button className="px-btn px-btn--ghost" type="submit" disabled={busy}>
              {busy && busyIntent === "refresh" ? "Refreshing…" : "Refresh from Shopify"}
            </button>
          </Form>
        </div>
        {!data.partnerConfigured ? (
          <p className="staff-hint">
            Refresh checks the store&rsquo;s Shopify plan. Subscription details need the Partner API,
            which is not set up on this server yet, so they come from the merchant&rsquo;s last app
            open and Shopify&rsquo;s webhooks.
          </p>
        ) : null}
        <dl className="staff-dl">
          <DetailRow label="Shopify status">
            {store.status || "none"}
            {store.shopifyEntitled ? " (paying)" : ""}
          </DetailRow>
          <DetailRow label="Plan">{billing.subscriptionName || store.planHandle || "—"}</DetailRow>
          <DetailRow label="Shopify store plan">
            {billing.shopPlanName || "—"}
            {billing.developmentStore ? " · development store, Priceify is free" : ""}
            {billing.shopPlanCheckedAt ? ` · checked ${formatConsoleDateTime(billing.shopPlanCheckedAt)}` : ""}
          </DetailRow>
          <DetailRow label="Price">{priceLabel(billing)}</DetailRow>
          <DetailRow label="Test charge">
            {billing.test == null ? "—" : billing.test ? "Yes" : "No"}
          </DetailRow>
          <DetailRow label="Subscribed">{formatConsoleDate(billing.createdAt)}</DetailRow>
          <DetailRow label="Trial ends">{formatConsoleDate(billing.trialEndsAt)}</DetailRow>
          <DetailRow label="Current period ends">{formatConsoleDate(billing.currentPeriodEnd)}</DetailRow>
          <DetailRow label="Ended">{formatConsoleDate(billing.endedAt)}</DetailRow>
          <DetailRow label="Last checked">
            {formatConsoleDateTime(store.checkedAt)}
            {billing.source ? ` · ${billingSourceLabel(billing.source)}` : ""}
          </DetailRow>
          <DetailRow label="Partner API">
            {billing.partnerCheckedAt
              ? `${billing.partnerHasContract ? "Active contract" : "No active contract"} · ${formatConsoleDateTime(billing.partnerCheckedAt)}`
              : "Not checked yet"}
          </DetailRow>
          <DetailRow label="Installed">{formatConsoleDate(store.installedAt)}</DetailRow>
          {store.uninstalledAt ? (
            <DetailRow label="Uninstalled">{formatConsoleDate(store.uninstalledAt)}</DetailRow>
          ) : null}
          <DetailRow label="Last app open">{formatConsoleDateTime(billing.lastAppOpenAt)}</DetailRow>
          <DetailRow label="Running tests">{String(store.runningTests)}</DetailRow>
          <DetailRow label="Shopify IDs">
            <span className="console-mono">{billing.shopGid || "shop ID not saved yet"}</span>
            {billing.subscriptionGid ? (
              <>
                <br />
                <span className="console-mono">{billing.subscriptionGid}</span>
              </>
            ) : null}
          </DetailRow>
        </dl>
      </div>

      <div className="px-card staff-panel-card">
        <h2 className="staff-section-title">Support access</h2>
        <p className="staff-hint">
          Unlocks the paid features for a set time without touching the store&rsquo;s Shopify plan.
          When it ends the store goes back to whatever Shopify says. Use it for our own billing
          problems and pre-launch stores; use private plans or trial extensions in the Partner
          Dashboard for discounts.
        </p>
        {current ? (
          <>
            <dl className="staff-dl">
              <DetailRow label="Ends">{formatConsoleDateTime(current.expiresAt)}</DetailRow>
              <DetailRow label="Given by">{current.grantedBy}</DetailRow>
              <DetailRow label="Reason">{current.reason}</DetailRow>
              <DetailRow label="Started">{formatConsoleDateTime(current.startsAt)}</DetailRow>
            </dl>
            {isOwner ? (
              <div className="console-grant-actions">
                <Form method="post" className="staff-filters">
                  <input type="hidden" name="intent" value="extend" />
                  <input type="hidden" name="grantId" value={current.id} />
                  <label className="staff-label" htmlFor="extend-days">
                    Extend to, from now
                    <DaysSelect id="extend-days" options={dayOptions} />
                  </label>
                  <button className="px-btn px-btn--ghost" type="submit" disabled={busy}>
                    {busy && busyIntent === "extend" ? "Extending…" : "Extend"}
                  </button>
                </Form>
                <Form
                  method="post"
                  className="staff-filters"
                  onSubmit={(event) => {
                    if (!window.confirm("End support access now? The store goes back to its Shopify plan.")) {
                      event.preventDefault();
                    }
                  }}
                >
                  <input type="hidden" name="intent" value="revoke" />
                  <input type="hidden" name="grantId" value={current.id} />
                  <label className="staff-label" htmlFor="revoke-reason">
                    Why (optional)
                    <input id="revoke-reason" className="staff-input" name="reason" maxLength={500} />
                  </label>
                  <button className="px-btn px-btn--ghost" type="submit" disabled={busy}>
                    {busy && busyIntent === "revoke" ? "Ending…" : "End now"}
                  </button>
                </Form>
              </div>
            ) : (
              <p className="staff-hint">Only owners can extend or end support access.</p>
            )}
          </>
        ) : !store.installed ? (
          <p className="staff-hint">This store has uninstalled Priceify.</p>
        ) : isOwner ? (
          <Form method="post" className="staff-form">
            <input type="hidden" name="intent" value="grant" />
            <label className="staff-label" htmlFor="grant-days">
              Length
              <DaysSelect id="grant-days" options={dayOptions} />
            </label>
            <label className="staff-label" htmlFor="grant-reason">
              Reason (shown in the store&rsquo;s history)
              <textarea
                id="grant-reason"
                className="staff-input"
                name="reason"
                rows={3}
                required
                minLength={10}
                maxLength={500}
                placeholder="For example: webhook missed after checkout, unlocking until Shopify catches up"
              />
            </label>
            <button className="px-btn px-btn--brand" type="submit" disabled={busy}>
              {busy && busyIntent === "grant" ? "Giving access…" : "Give support access"}
            </button>
          </Form>
        ) : (
          <p className="staff-hint">No support access. Only owners can give it.</p>
        )}

        {data.grants.length ? (
          <details className="staff-raw">
            <summary>All support access for this store ({data.grants.length})</summary>
            <ul className="console-list">
              {data.grants.map((grant: Grant) => (
                <li key={grant.id}>
                  {formatConsoleDate(grant.startsAt)} → {formatConsoleDate(grant.expiresAt)} · {grant.grantedBy} ·{" "}
                  {grant.reason}
                  {grant.revokedAt
                    ? ` · ended early by ${grant.revokedBy}${grant.revokeReason ? ` (${grant.revokeReason})` : ""}`
                    : ""}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>

      <div className="px-card staff-panel-card">
        <h2 className="staff-section-title">Billing history</h2>
        {data.billingEvents?.length ? (
          <ul className="console-list">
            {data.billingEvents.map(
              (event: { id: number; status: string; planHandle?: string; source: string; createdAt: string }) => (
                <li key={event.id}>
                  <span className="console-strong">{formatConsoleDateTime(event.createdAt)}</span> ·{" "}
                  {billingEventLabel(event.status)}
                  {event.planHandle ? ` · ${event.planHandle}` : ""} · {billingSourceLabel(event.source)}
                </li>
              ),
            )}
          </ul>
        ) : (
          <p className="staff-hint">No plan changes recorded yet.</p>
        )}
      </div>

      <div className="px-card staff-panel-card">
        <h2 className="staff-section-title">Console activity</h2>
        {data.activity?.length ? (
          <ul className="console-list">
            {data.activity.map(
              (item: { id: number; actorEmail: string; action: string; createdAt: string; targetId?: string }) => (
                <li key={item.id}>
                  <span className="console-strong">{formatConsoleDateTime(item.createdAt)}</span> ·{" "}
                  {item.actorEmail} · {consoleActionLabel(item.action)}
                  {item.targetId && item.action.startsWith("ticket.") ? ` ${item.targetId}` : ""}
                </li>
              ),
            )}
          </ul>
        ) : (
          <p className="staff-hint">Nobody has acted on this store from the console yet.</p>
        )}
      </div>

      <div className="px-card staff-panel-card">
        <h2 className="staff-section-title">Tickets</h2>
        {data.tickets?.length ? (
          <ul className="console-list">
            {data.tickets.map((ticket: { public_id: string; subject: string; status: string }) => (
              <li key={ticket.public_id}>
                <Link to={ticketHref(ticket.public_id)}>{ticket.public_id}</Link> · {ticket.subject} ·{" "}
                {ticketStatusLabel(ticket.status, { staff: true })}
              </li>
            ))}
          </ul>
        ) : (
          <p className="staff-hint">No tickets from this store.</p>
        )}
      </div>
    </section>
  );
}
