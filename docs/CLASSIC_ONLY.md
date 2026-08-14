# Classic-only Smart Pricing in RipsPriceX

Full research hub: [research/README.md](./research/README.md) · parity: [research/02_PARITY_MATRIX.md](./research/02_PARITY_MATRIX.md)

## Scope

- **Only** Classic Smart Pricing UI (Figma / EchoTest) from RipX
- **Only** Smart Pricing feature (price experiments)
- Shopify Admin App Nav + TitleBar (no RipX sidebar / Domains / other test types)

## Ported UI

`app/components/SmartPricing/classic/**` (51 files) including:

- Experiment list, 5-step create wizard, experiment overview + tabs
- Product picker, goal picker, audience helpers, Classic CSS + assets

Wired routes:

| App Nav | Route | Component |
|---------|-------|-----------|
| Experiments | `/app` | `ClassicExperimentsList` |
| Create | `/app/experiments/new` | `ClassicCreateWizard` (locked if unpaid) |
| (drill-in) | `/app/experiments/:planId` | `ClassicExperimentOverview` |
| Setup | `/app/setup` | Readiness checklist |
| Settings | `/app/settings` | Plan · Guardrails · Installation · Price surfaces |
| (compat) | `/app/billing` → Plan tab | Legacy billing URL |

## Runtime still required for full shop parity

1. Partner app `npm run config:link` + App Pricing
2. Theme embed + cart transform deployed
3. Offline access token in `shop_sessions` for catalog GraphQL
4. Plus or development store for checkout money path

## Verify

```bash
npm run migrate:api
npm run dev:api
npm run accept
npm run config:link && npm run dev
```
