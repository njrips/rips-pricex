import { expressApiBase, internalServiceHeaders } from "./expressInternalApi.server";

/**
 * Whether the shop is paying, according to Shopify rather than to our own copy.
 *
 * The app used to answer this from its own `shops` table alone, and nothing
 * ever wrote a paid status into that table from Shopify: the only caller of
 * sync-entitlement ran behind `if (!entitled) return`, so a shop could only be
 * told it was paid once it already was. In production that meant `none` was
 * terminal in both directions -- a merchant who completed checkout stayed
 * locked out, and a merchant who cancelled kept full access indefinitely.
 *
 * `billing.check()` is deliberately not used. It was removed from the loader
 * because a 401 invalidates the offline session and an App Pricing hang blocks
 * the Admin iframe, and both of those reasons still hold. A plain Admin
 * GraphQL query has neither failure mode: it cannot revoke the session, and
 * every caller here bounds it with its own timeout and treats no answer as
 * "we did not find out", never as "not paying".
 */

/** Only ACTIVE pays. FROZEN in particular is a shop Shopify has stopped billing. */
const PAYING_STATUS = "ACTIVE";

export const ACTIVE_SUBSCRIPTIONS_QUERY = `#graphql
  query PriceifyAppSubscriptionState {
    shop {
      id
      plan { partnerDevelopment publicDisplayName }
    }
    currentAppInstallation {
      activeSubscriptions {
        id
        name
        status
        test
        createdAt
        currentPeriodEnd
        trialDays
        lineItems {
          plan {
            pricingDetails {
              __typename
              ... on AppRecurringPricing {
                interval
                price { amount currencyCode }
              }
            }
          }
        }
      }
    }
  }
`;

/** What the console shows about a subscription. Absent fields keep their stored value. */
export type SubscriptionDetails = {
  shopGid?: string | null;
  subscriptionGid?: string | null;
  subscriptionName?: string | null;
  test?: boolean | null;
  createdAt?: string | null;
  trialEndsAt?: string | null;
  currentPeriodEnd?: string | null;
  interval?: string | null;
  price?: number | string | null;
  currency?: string | null;
};

export type SubscriptionEntitlement = {
  entitled: boolean;
  status: string;
  planHandle: string | null;
  details?: SubscriptionDetails;
  /**
   * Shopify's `shop.plan.partnerDevelopment`. Development stores use Priceify
   * free; undefined when the answer did not include the plan.
   */
  developmentStore?: boolean;
  shopPlanName?: string | null;
};

type RecurringPricing = {
  __typename?: string;
  interval?: string | null;
  price?: { amount?: string | number | null; currencyCode?: string | null } | null;
};

type ActiveSubscription = {
  id?: string | null;
  name?: string | null;
  status?: string | null;
  test?: boolean | null;
  createdAt?: string | null;
  currentPeriodEnd?: string | null;
  trialDays?: number | null;
  lineItems?: Array<{ plan?: { pricingDetails?: RecurringPricing | null } | null } | null> | null;
};

/**
 * Shopify reports trial length, not its end. Counting from the subscription's
 * creation is close enough for the console; the Partner API check replaces it
 * with Shopify's own date, which also includes trial extensions.
 */
function trialEndFrom(createdAt: string | null | undefined, trialDays: number | null | undefined) {
  const days = Number(trialDays || 0);
  const start = createdAt ? new Date(createdAt).getTime() : NaN;
  if (!days || !Number.isFinite(start)) return null;
  return new Date(start + days * 24 * 60 * 60 * 1000).toISOString();
}

export function subscriptionDetails(
  subscription: ActiveSubscription | null | undefined,
  shopGid?: string | null,
): SubscriptionDetails {
  const recurring = (subscription?.lineItems || [])
    .map(item => item?.plan?.pricingDetails)
    .find(pricing => pricing?.__typename === "AppRecurringPricing");
  return {
    shopGid: shopGid || null,
    subscriptionGid: subscription?.id || null,
    subscriptionName: subscription?.name || null,
    test: subscription?.test ?? null,
    createdAt: subscription?.createdAt || null,
    trialEndsAt: trialEndFrom(subscription?.createdAt, subscription?.trialDays),
    currentPeriodEnd: subscription?.currentPeriodEnd || null,
    interval: recurring?.interval || null,
    price: recurring?.price?.amount ?? null,
    currency: recurring?.price?.currencyCode || null,
  };
}

/**
 * Shopify names plans for display ("Priceify Growth"); our column wants a
 * handle. Nothing gates on the handle today -- `requireEntitlement` only reads
 * `entitled` -- so this is for the merchant's own reference, and a readable
 * slug of the real plan name beats inventing a tier we cannot verify.
 */
function planHandleFromName(name: string | null | undefined): string | null {
  const slug = String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slug || null;
}

/** The entitlement implied by one subscription's status, from any source. */
export function entitlementFromStatus(
  status: string | null | undefined,
  name?: string | null,
): SubscriptionEntitlement {
  const normalized = String(status || "")
    .trim()
    .toUpperCase();
  const entitled = normalized === PAYING_STATUS;
  return {
    entitled,
    status: normalized || "none",
    planHandle: entitled ? planHandleFromName(name) : null,
  };
}

/**
 * Read an entitlement out of an activeSubscriptions response.
 *
 * An empty list is a real answer, not a missing one: it means this shop has no
 * subscription, which is exactly the case that has to be able to revoke access.
 */
export function entitlementFromActiveSubscriptions(
  subscriptions: ActiveSubscription[] | null | undefined,
  shopGid?: string | null,
): SubscriptionEntitlement {
  const rows = Array.isArray(subscriptions) ? subscriptions : [];
  const paying = rows.find(
    row =>
      String(row?.status || "")
        .trim()
        .toUpperCase() === PAYING_STATUS,
  );
  // Nothing active. Report the first status we were given so the log says
  // whether this shop cancelled, expired or never subscribed.
  const chosen = paying || rows[0];
  return {
    ...entitlementFromStatus(chosen?.status || "none", chosen?.name),
    details: subscriptionDetails(chosen, shopGid),
  };
}

/**
 * Just the one call we make, so the Admin client satisfies it structurally and
 * a test can hand over a stub without reconstructing the whole context.
 */
type AdminGraphqlClient = {
  graphql: (query: string) => Promise<Response>;
};

/**
 * Ask Shopify what this shop is paying for.
 *
 * Returns `null` when we could not find out -- a timeout, a network fault, or
 * a shape we do not recognise. Callers must fall back to their cached value on
 * `null` and never read it as "not paying", or a blip in the Admin API would
 * lock a paying merchant out of their own app.
 */
export async function fetchSubscriptionEntitlement(
  admin: AdminGraphqlClient | null | undefined,
  { timeoutMs = 2500 }: { timeoutMs?: number } = {},
): Promise<SubscriptionEntitlement | null> {
  if (!admin?.graphql) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const expired = Symbol("timeout");
    // Raced rather than passed as a signal because the Admin client does not
    // take one. The bound is the point: this runs in the /app loader, and an
    // unbounded await here is what leaves the Admin iframe on "Loading".
    const settled = await Promise.race([
      admin.graphql(ACTIVE_SUBSCRIPTIONS_QUERY).then(res => res.json()),
      new Promise<typeof expired>(resolve => {
        timer = setTimeout(() => resolve(expired), timeoutMs);
      }),
    ]);
    if (settled === expired) return null;
    const body = settled as {
      data?: {
        shop?: {
          id?: string | null;
          plan?: { partnerDevelopment?: boolean | null; publicDisplayName?: string | null } | null;
        } | null;
        currentAppInstallation?: { activeSubscriptions?: ActiveSubscription[] };
      };
      errors?: unknown;
    };
    // A GraphQL error means the query did not run, so we learned nothing. The
    // shop may well be paying.
    if (body?.errors) return null;
    const installation = body?.data?.currentAppInstallation;
    if (!installation) return null;
    const plan = body?.data?.shop?.plan;
    return {
      ...entitlementFromActiveSubscriptions(
        installation.activeSubscriptions,
        body?.data?.shop?.id || null,
      ),
      ...(typeof plan?.partnerDevelopment === "boolean"
        ? { developmentStore: plan.partnerDevelopment, shopPlanName: plan.publicDisplayName || null }
        : {}),
    };
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Write an entitlement we learned from Shopify into the Express database.
 *
 * Both directions travel this path. A revocation matters more than an unlock:
 * the cancel-policy sweep pauses running tests for any shop whose entitlement
 * is not current, so recording the lapse is what eventually takes a cancelled
 * merchant's tests off their storefront.
 */
export async function pushEntitlementToExpress(
  shop: string,
  entitlement: SubscriptionEntitlement,
  { source }: { source?: "loader" | "webhook" } = {},
): Promise<void> {
  const res = await fetch(`${expressApiBase()}/api/billing/sync-entitlement`, {
    method: "POST",
    headers: internalServiceHeaders(shop),
    body: JSON.stringify({
      entitled: entitlement.entitled,
      status: entitlement.entitled ? entitlement.status : "none",
      shopifyStatus: entitlement.status,
      planHandle: entitlement.planHandle,
      details: entitlement.details || {},
      ...(typeof entitlement.developmentStore === "boolean"
        ? { developmentStore: entitlement.developmentStore, shopPlanName: entitlement.shopPlanName || null }
        : {}),
      source,
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    throw new Error(`sync-entitlement answered HTTP ${res.status}`);
  }
}
