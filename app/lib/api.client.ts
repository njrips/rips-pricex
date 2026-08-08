/**
 * Client API helper — always same-origin `/api` (Vite proxy → Express).
 */
export type AppOutletContext = {
  shop: string;
  entitled: boolean;
  upgradeUrl: string;
  apiBase: string;
  planHandle: string | null;
};

function apiRoot(ctx: AppOutletContext) {
  // Prefer same-origin proxy for embedded Admin
  const base = ctx?.apiBase && ctx.apiBase.startsWith("/") ? ctx.apiBase : "/api";
  return base.replace(/\/+$/, "");
}

async function api<T = unknown>(
  ctx: AppOutletContext,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const url = `${apiRoot(ctx)}${path.startsWith("/") ? path : `/${path}`}`;
  const headers = new Headers(init.headers || {});
  headers.set("X-Shopify-Shop-Domain", ctx.shop);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(url, { ...init, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(
      (data as { error?: string; message?: string }).error ||
        (data as { message?: string }).message ||
        res.statusText,
    ) as Error & { status?: number; payload?: unknown };
    err.status = res.status;
    err.payload = data;
    throw err;
  }
  return data as T;
}

export const rpxApi = {
  billingStatus: (ctx: AppOutletContext) =>
    api<{ entitled: boolean; upgradeUrl: string; planHandle: string | null }>(
      ctx,
      "/billing/status",
    ),
  inboxPlans: (ctx: AppOutletContext) =>
    api<{ plans: unknown[]; success?: boolean }>(ctx, "/smart-pricing/inbox/plans"),
  inboxSummary: (ctx: AppOutletContext) =>
    api<Record<string, unknown>>(ctx, "/smart-pricing/inbox/summary"),
  saveInboxPlans: (ctx: AppOutletContext, plans: unknown[]) =>
    api(ctx, "/smart-pricing/inbox/plans", {
      method: "PUT",
      body: JSON.stringify({ plans }),
    }),
  deleteInboxPlan: (ctx: AppOutletContext, planId: string) =>
    api(ctx, `/smart-pricing/inbox/plans/${encodeURIComponent(planId)}`, {
      method: "DELETE",
    }),
  checkoutReadiness: (ctx: AppOutletContext) =>
    api<{ ready: boolean; hints?: string[] }>(ctx, "/smart-pricing/checkout-readiness"),
  status: (ctx: AppOutletContext) =>
    api<{ entitled?: boolean; capabilities?: Record<string, boolean> }>(
      ctx,
      "/smart-pricing/status",
    ),
  launchPlan: (ctx: AppOutletContext, plan: unknown, autoStart = true) =>
    api(ctx, "/smart-pricing/plans/launch", {
      method: "POST",
      body: JSON.stringify({ plan, auto_start: autoStart }),
    }),
  ensurePreview: (ctx: AppOutletContext, planId: string) =>
    api(ctx, `/smart-pricing/inbox/plans/${encodeURIComponent(planId)}/ensure-preview-test`, {
      method: "POST",
      body: "{}",
    }),
  testAnalytics: (ctx: AppOutletContext, testId: string) =>
    api(ctx, `/smart-pricing/tests/${encodeURIComponent(testId)}/analytics`),
  winnerPreview: (ctx: AppOutletContext, testId: string) =>
    api(ctx, `/smart-pricing/tests/${encodeURIComponent(testId)}/winner-preview`),
  applyWinner: (ctx: AppOutletContext, testId: string, body: unknown = {}) =>
    api(ctx, `/smart-pricing/tests/${encodeURIComponent(testId)}/apply-winner`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  startTest: (ctx: AppOutletContext, testId: string) =>
    api(ctx, `/tests/${encodeURIComponent(testId)}/start`, { method: "POST", body: "{}" }),
  stopTest: (ctx: AppOutletContext, testId: string) =>
    api(ctx, `/tests/${encodeURIComponent(testId)}/stop`, { method: "POST", body: "{}" }),
  getGuardrails: (ctx: AppOutletContext) => api(ctx, "/smart-pricing/guardrails"),
  saveGuardrails: (ctx: AppOutletContext, guardrails: unknown) =>
    api(ctx, "/smart-pricing/guardrails", {
      method: "POST",
      body: JSON.stringify(guardrails),
    }),
  markUninstall: (ctx: AppOutletContext) =>
    api(ctx, "/shops/uninstall", { method: "POST", body: "{}" }),
};
