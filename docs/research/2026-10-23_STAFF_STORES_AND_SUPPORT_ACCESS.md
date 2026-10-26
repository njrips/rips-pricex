# Staff Stores panel and support access grants

Date: 2026-10-23
Status: Planned, not started.

## Problem

A shop without an active plan is locked, and only a Shopify purchase unlocks it.
If billing goes wrong on our side (a missed webhook, a failed sync, a Shopify API
outage, a store before launch) staff have no safe, recorded way to unlock a store,
and no screen showing every installed store with its purchase status and dates.

## Findings

1. **A lapsed plan freezes more than the create flow.**
   `requireEntitlement` (`server/src/services/billing/entitlementService.js`) refuses
   every Smart Pricing write except those in `isFreeSmartPricingRequest`
   (`server/src/routes/smartPricingRoutes.js`): GETs, stop/finish/release product,
   and deleting drafts or inbox plans. Create, launch, edit, AI Suggest, resume and
   apply winner are all refused. The cancel-policy sweep
   (`pauseStaleRunningOnCancelPolicy` in `server/src/jobs/backgroundJobs.js`, every
   10 minutes) also pauses every running test of an unentitled shop.

2. **A manual unlock in the database does not last.** Every `/app` load
   (`resolveEntitlement` in `app/routes/app.tsx`) and every `app_subscriptions/update`
   webhook asks Shopify for `currentAppInstallation.activeSubscriptions` and
   overwrites `shops.entitlement_status` through `/api/billing/sync-entitlement`.

3. **The only bypass is a hidden "dev" plan.** A shop with `plan_handle = 'dev'`
   and an entitled status is kept entitled by both the loader and
   `sync-entitlement`. It is set by hand in SQL, with no expiry, no record of who
   set it, and no UI. All three production shops use it (2026-10-22);
   `priceify-test-nzrvaiqz` was `dev` + `none` (locked) and was set back to
   `ACTIVE` on request.

4. **No real merchant can buy yet.** `SHOPIFY_APP_PRICING_READY` is not set in
   production, so the plan page is unavailable and every non-dev store stays locked.

5. **Billing dates are not stored.** `shops` has only `plan_handle`,
   `entitlement_status`, `entitlement_checked_at`, `installed_at`, `uninstalled_at`,
   `created_at`, `updated_at`. No subscription ID, plan name, purchase date, trial
   end, renewal date, cancel/expiry date or test-charge flag. Each status change
   overwrites the last, so there is no history.

6. **Shopify covers the commercial cases without code** (Partner Dashboard):
   - Private plans: free or custom plans visible only to named store domains.
     <https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing/plans>
   - Trial extensions: extra trial days for one merchant; Shopify applies them and
     emails the merchant.
     <https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing/subscription-billing/offer-free-trials>

7. **Staff sessions are not per person.** The staff cookie is an HMAC of the shared
   `RIPSPRICEX_STAFF_SUPPORT_TOKEN` (`server/src/services/support/staffAuth.js`):
   the same value for everyone, no email, not revocable per person. Fine for
   tickets, not for granting paid access.

8. **No regular subscription check.** Status refreshes only when the merchant opens
   the app or a webhook arrives. A daily check from the API needs working offline
   tokens first: the API's copy of an expiring offline token is refreshed only when
   the merchant opens the app, so background Admin API calls already fail with 401.

## To-do

**No code (Partner Dashboard):**

1. Create the App Pricing plans and set `SHOPIFY_APP_PRICING_READY=true` in production.
2. Use private plans for free/beta stores and trial extensions for goodwill instead
   of database edits.

**Build, in order:**

3. **Store billing details.** Subscription ID, plan name, purchase date, trial end,
   renewal date (`currentPeriodEnd`), cancel/expiry date, test-charge flag; filled
   from the loader's subscription query (add `createdAt`, `currentPeriodEnd`,
   `trialDays`, `test`) and the webhook payload. Add a status history table.
   Optionally backfill from the Partner API's subscription and billing event APIs.
4. **Read-only Stores page** at `/staff/stores`: plan, status, dates, status source
   (Shopify, support grant, dev plan), test charge, running/paused tests, last app
   open, token health, open tickets. Filters for locked, expiring soon and
   uninstalled. A **Refresh from Shopify** button per store.
5. **Per-person staff sessions** carrying the staff email, with per-session expiry,
   so every action is attributed.
6. **Time-limited support grants** replacing the dev plan:
   - Grant table: shop, granted by, reason, starts, expires (required, at most
     ~30 days), revoked at/by.
   - Access = active Shopify plan **or** current grant. Honour it in the loader,
     `sync-entitlement` and the cancel-policy sweep (the sweep reads
     `entitlement_status` directly in SQL, so missing it still pauses tests).
   - On expiry the store returns to its real status by itself; the merchant sees
     "Access provided by Priceify support until …".
   - Audit log for every grant and revoke.
7. **Move the three dev-plan shops to grants**, then delete the dev-plan code paths.
8. **Daily subscription check** for every installed store, after the offline-token
   fix (see the hosting-move work: shared token store with refresh).
