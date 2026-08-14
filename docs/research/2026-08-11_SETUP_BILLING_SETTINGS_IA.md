# 2026-08-11 — Setup / Billing / Settings IA

**Status:** Done + follow-up upgrades (same day)  
**Decision:** Keep Setup in App Nav; fold Billing into **Settings → Plan**; 4-item nav.

## Shopify research (re-checked)

| Source | Takeaway for RipsPriceX |
|--------|-------------------------|
| [App navigation IA](https://shopify.dev/docs/apps/design/navigation) | Fewest nav categories; nouns; tabs only for secondary in-page nav; don’t put main nav in page header |
| [Shopify App Pricing](https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing) | Plan selection is Shopify-hosted (`pricing_plans`); in-app surface is status + `_top` upgrade |
| [Redirect to plan selection](https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing/redirect-plan-selection-page) | Client must break out of iframe (`target: _top` / top-frame assign); cannot NavMenu-link `pricing_plans` |
| Welcome / redirection URL | Configure relative `/app/welcome`; Shopify appends `plan_handle` (and retires `charge_id` after 2026-04-28) |
| Partner forums (Managed Pricing / NavMenu) | Dedicated Billing **nav** is optional — in-app Plan tab + `_top` redirect is the supported pattern |
| Onboarding / setup-guide guidance | Checklist ≠ billing admin; Setup stays first-class |

**Conclusion:** The locked IA (Setup separate; Plan under Settings; no Billing nav) matches current Shopify guidance.

**Watch:** After April 28, 2026, App Pricing subscription **webhooks** and `charge_id` redirects are retired — use Partner API + `plan_handle` (Track A).

## As-built

| Surface | Path |
|---------|------|
| App Nav | Experiments · Create · Setup · Settings |
| Plan | `/app/settings?tab=plan` |
| Compat | `/app/billing` → Plan tab (`billing`/`setup`/`surfaces` aliases canonicalized) |
| Welcome (post-charge) | `/app/welcome` — Partner welcome URL |
| Create step 1 label | **Basics** |
| Settings default tab | Guardrails (no `?tab=`) |

## Upgrades (follow-up pass)

| Change | Why |
|--------|-----|
| `POST /api/billing/sync-entitlement` | Production-safe sync from Admin `billing.check` (replaces loader’s `dev-entitle` call) |
| Prefer `window.top.location.assign` for pricing | Matches Shopify `_top` redirect pattern when App Bridge intents missing |
| Classic locked Create + Plan welcome | Same IA chrome; clear next steps after pay |
| List banners use `navigate` | Embedded-safe (no Polaris `url` full reload) |
| Plan CTAs Upgrade/Manage + Create when unlocked | Verb+noun Shopify page-action guidance |
| Shared `buildPricingPlansUrl` | One place for charges URL construction |

## Partner setup reminder

1. Set `SHOPIFY_APP_HANDLE` to the Partner Dashboard app handle.  
2. In App Pricing plan config, set **Welcome URL** to `/app/welcome`.  
3. Merchants land with `?plan_handle=…` → Setup → Create.

## Success criteria

- “Where do I pay?” → Settings → Plan  
- “Why can’t I launch?” → Setup  
- “Where are guardrails / selectors?” → Settings tabs  
- No third top-level page for Shopify-hosted pricing  
- After purchase → `/app/welcome` → Setup  
