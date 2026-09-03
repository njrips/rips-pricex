/**
 * Client API helper — always same-origin `/api` (Vite proxy → Express).
 */
import { getSessionToken } from "./sessionToken";

export type AppOutletContext = {
  shop: string;
  entitled: boolean;
  upgradeUrl: string;
  apiBase: string;
  planHandle: string | null;
  /** Shopify app client id (loader) — used for theme embed deep links */
  apiKey?: string;
  /** True when RIPSPRICEX_DEV_ENTITLE_ALL unlocked Create locally */
  devEntitleAll?: boolean;
  /** Dev-only storefront password from .env (never shown in the Settings UI) */
  devStorefrontPassword?: string;
  /** Shopify staff email from the Admin session when present */
  staffEmail?: string;
};

/**
 * All a request actually needs. Callers holding the full outlet context still
 * satisfy this, and it lets a component depend on the two fields that matter
 * instead of a context object whose identity changes on every render.
 */
export type ApiTarget = Pick<AppOutletContext, "shop" | "apiBase">;

function apiRoot(ctx: ApiTarget) {
  // Prefer same-origin proxy for embedded Admin
  const base = ctx?.apiBase && ctx.apiBase.startsWith("/") ? ctx.apiBase : "/api";
  return base.replace(/\/+$/, "");
}

async function api<T = unknown>(
  ctx: ApiTarget,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const url = `${apiRoot(ctx)}${path.startsWith("/") ? path : `/${path}`}`;
  const headers = new Headers(init.headers || {});
  headers.set("X-Shopify-Shop-Domain", ctx.shop);
  if (!headers.has("Authorization")) {
    const token = await getSessionToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
  }
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
  billingStatus: (ctx: ApiTarget) =>
    api<{
      entitled: boolean;
      upgradeUrl?: string;
      planHandle: string | null;
      status?: string;
      shop?: string;
      checkedAt?: string;
      success?: boolean;
    }>(ctx, "/billing/status"),
  inboxPlans: (ctx: ApiTarget) =>
    api<{ plans: unknown[]; success?: boolean }>(ctx, "/smart-pricing/inbox/plans"),
  inboxSummary: (ctx: ApiTarget) =>
    api<Record<string, unknown>>(ctx, "/smart-pricing/inbox/summary"),
  saveInboxPlans: (ctx: ApiTarget, plans: unknown[]) =>
    api(ctx, "/smart-pricing/inbox/plans", {
      method: "PUT",
      body: JSON.stringify({ plans }),
    }),
  deleteInboxPlan: (ctx: ApiTarget, planId: string) =>
    api(ctx, `/smart-pricing/inbox/plans/${encodeURIComponent(planId)}`, {
      method: "DELETE",
    }),
  checkoutReadiness: (ctx: ApiTarget) =>
    api<{
      success?: boolean;
      ready?: boolean;
      hints?: string[];
      readiness?: {
        ready?: boolean;
        hints?: string[];
        failed_checks?: string[];
        checks?: unknown[];
        message?: string;
        price_surface?: Record<string, unknown>;
      };
      failed_checks?: string[];
      checks?: unknown[];
      message?: string;
      price_surface?: Record<string, unknown>;
    }>(ctx, "/smart-pricing/checkout-readiness"),
  status: (ctx: ApiTarget) =>
    api<{ entitled?: boolean; capabilities?: Record<string, boolean> }>(
      ctx,
      "/smart-pricing/status",
    ),
  launchPlan: (ctx: ApiTarget, plan: unknown, autoStart = true) =>
    api(ctx, "/smart-pricing/plans/launch", {
      method: "POST",
      body: JSON.stringify({ plan, auto_start: autoStart }),
    }),
  ensurePreview: (ctx: ApiTarget, planId: string) =>
    api(ctx, `/smart-pricing/inbox/plans/${encodeURIComponent(planId)}/ensure-preview-test`, {
      method: "POST",
      body: "{}",
    }),
  testAnalytics: (ctx: ApiTarget, testId: string) =>
    api(ctx, `/smart-pricing/tests/${encodeURIComponent(testId)}/analytics`),
  winnerPreview: (ctx: ApiTarget, testId: string) =>
    api(ctx, `/smart-pricing/tests/${encodeURIComponent(testId)}/winner-preview`),
  applyWinner: (ctx: ApiTarget, testId: string, body: unknown = {}) =>
    api(ctx, `/smart-pricing/tests/${encodeURIComponent(testId)}/apply-winner`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  startTest: (ctx: ApiTarget, testId: string) =>
    api(ctx, `/tests/${encodeURIComponent(testId)}/start`, { method: "POST", body: "{}" }),
  stopTest: (ctx: ApiTarget, testId: string) =>
    api(ctx, `/tests/${encodeURIComponent(testId)}/stop`, { method: "POST", body: "{}" }),
  getGuardrails: (ctx: ApiTarget) => api(ctx, "/smart-pricing/guardrails"),
  saveGuardrails: (ctx: ApiTarget, guardrails: unknown) =>
    api(ctx, "/smart-pricing/guardrails", {
      method: "POST",
      body: JSON.stringify(guardrails),
    }),
  markUninstall: (ctx: ApiTarget) =>
    api(ctx, "/shops/uninstall", { method: "POST", body: "{}" }),
  settingsInstallation: (ctx: ApiTarget) =>
    api<{
      success?: boolean;
      platform?: string;
      scriptUrl?: string;
      directUrl?: string;
      snippetHtml?: string;
      mainTheme?: {
        id?: string | null;
        numericId?: string | null;
        name?: string | null;
        role?: string | null;
      } | null;
      themeEmbed?: {
        blockHandle?: string;
        activateAppId?: string | null;
        shopifyUrl?: string | null;
        httpsUrl?: string | null;
        themeSegment?: string;
      };
      instructions?: Record<string, unknown>;
    }>(ctx, "/settings/installation"),
};
