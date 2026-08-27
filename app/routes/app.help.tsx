import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useActionData, useLoaderData, useOutletContext } from "react-router";
import { authenticate } from "../shopify.server";
import type { AppOutletContext } from "../lib/api.client";
import ClassicHelpPage from "../components/SmartPricing/classic/ClassicHelpPage";
import {
  expressSupportFetch,
  supportErrorMessage,
} from "../utils/expressSupportApi.server";
import {
  isPublicIdFormat,
  merchantTicketLookupError,
  pickAttentionTicket,
  shouldAutoOpenAttention,
} from "../components/SmartPricing/classic/helpFaq";
import { withEmbeddedSearch } from "../utils/shopifyEmbeddedSearch";

function sessionReplyEmail(session: {
  email?: string | null;
  onlineAccessInfo?: { associated_user?: { email?: string | null } };
}) {
  return String(
    session.email || session.onlineAccessInfo?.associated_user?.email || "",
  ).trim();
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const search = new URL(request.url).searchParams;
  const ticketId = search.get("ticket") || "";
  const notice =
    search.get("created") === "1"
      ? ticketId
        ? `Ticket ${ticketId.toUpperCase()} created`
        : "Ticket created"
      : search.get("sent") === "1"
        ? "Reply sent"
        : null;

  const listRes = await expressSupportFetch("/support/tickets", { shop });
  const tickets = Array.isArray(listRes.data?.tickets) ? listRes.data.tickets : [];
  if (shouldAutoOpenAttention({ ticketId, view: search.get("view") })) {
    const attentionId = pickAttentionTicket(tickets);
    if (attentionId) {
      throw redirect(withEmbeddedSearch(request, "/app/help", { ticket: attentionId }));
    }
  }

  let selectedTicket = null;
  let ticketError = null;
  if (ticketId) {
    if (!isPublicIdFormat(ticketId)) {
      ticketError = "Invalid ticket id";
    } else {
      const detail = await expressSupportFetch(
        `/support/tickets/${encodeURIComponent(ticketId)}`,
        { shop },
      );
      if (detail.ok) selectedTicket = detail.data?.ticket || null;
      else {
        ticketError = merchantTicketLookupError(
          detail.status,
          supportErrorMessage(detail.data, "Ticket not found"),
        );
      }
    }
  }

  return {
    tickets,
    selectedTicket,
    staffEmail: sessionReplyEmail(session),
    listError: listRes.ok ? null : supportErrorMessage(listRes.data, "Could not load tickets"),
    ticketError,
    notice,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const form = await request.formData();
  const intent = String(form.get("intent") || "create");

  if (intent === "reply") {
    const publicId = String(form.get("public_id") || "").trim();
    if (!isPublicIdFormat(publicId)) {
      return { error: "Invalid ticket id" };
    }
    const res = await expressSupportFetch(
      `/support/tickets/${encodeURIComponent(publicId)}/messages`,
      {
        shop,
        method: "POST",
        body: { body: String(form.get("body") || "") },
      },
    );
    if (!res.ok) {
      return { error: supportErrorMessage(res.data, "Could not send reply") };
    }
    return redirect(withEmbeddedSearch(request, "/app/help", { ticket: publicId, sent: "1" }));
  }

  const res = await expressSupportFetch("/support/tickets", {
    shop,
    method: "POST",
    body: {
      category: String(form.get("category") || ""),
      subject: String(form.get("subject") || ""),
      body: String(form.get("body") || ""),
      reply_email: String(form.get("reply_email") || ""),
    },
  });
  if (!res.ok) {
    return { error: supportErrorMessage(res.data, "Could not create ticket") };
  }
  const publicId = res.data?.ticket?.public_id;
  if (publicId) {
    return redirect(
      withEmbeddedSearch(request, "/app/help", { ticket: publicId, created: "1" }),
    );
  }
  return { notice: "Ticket created" };
};

export default function HelpRoute() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const ctx = useOutletContext<AppOutletContext>();

  return (
    <ClassicHelpPage
      tickets={data.tickets}
      selectedTicket={data.selectedTicket}
      staffEmail={data.staffEmail || ctx.staffEmail || ""}
      formError={actionData?.error || null}
      listError={data.listError}
      ticketError={data.ticketError}
      formNotice={actionData?.notice || data.notice || null}
    />
  );
}
