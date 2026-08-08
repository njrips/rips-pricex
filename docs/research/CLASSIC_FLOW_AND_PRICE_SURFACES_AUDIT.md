# Classic flow + price surfaces audit (vs RipX / design)

Date: 2026-08-09

## Verdict

| Area | Match to RipX Classic / design | Notes |
|------|--------------------------------|-------|
| Create wizard (Setup → Variations → Products → Audience → Review/Launch) | Yes | Classic pack ported; same panels |
| Experiment details tabs (Overview, Performance, Variations/preview/QR, Audience, Metrics, Activity, Settings) | Yes | All seven tabs present |
| Price mapping / theme price selectors | **Was missing → now ported** | Settings tab + APIs + Fix links |
| Live shop E2E (embed + cart transform + paint + winner) | Not fully proven | Needs Partner link + development store |

## Gaps found (before this pass)

1. `/app/settings` was guardrails-only; `?tab=installation` and `?tab=price-surfaces&automap=1` were ignored.
2. No `/api/settings/price-surfaces` or cart-transform ensure/status routes.
3. Auto-map / suggest services and `PriceSurfaceMappingsPanel` UI were not in the app.
4. Review launch fallback used RipX path `/app/:domain/settings?...`.

## Ported in this pass

- Backend: `priceSurfaceAutoMapService`, `priceSurfaceSuggestService`, `priceSurfaceHtmlProbe`, `priceSurfaceThemePacks`, slim `settingsRoutes` (installation, cart-transform, price-surfaces).
- Frontend: `PriceSurfaceMappingsPanel`, `StoreSettingsPriceSurfacesSection`, settings tabs, setup ensure CTAs.
- Wizard Fix setup / Fix price surfaces → `/app/settings?tab=…` via in-app navigate.

## Remaining soft gaps

- Goals & Metrics still routes to Settings (guardrails), not a separate Goals page.
- Live theme visual-pick and cart-transform ensure need a real Shopify session token.
- Partner `client_id` / `shopify app config link` still required for full Admin embed.
