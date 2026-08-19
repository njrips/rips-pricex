# 2026-08-18 — Revenue drop guardrail

**Track:** E (analytics & winner trust)  
**Status:** implemented

## Question

How do we limit a revenue drop on Classic price and offer tests **in any case**, without blocking launch on noisy projections?

## Decision

- Shop field: `max_revenue_drop_percent` (default **10**, clamp 3–50).
- Always on for every Smart Pricing launch (price and offer).
- Effective cap = **tighter of** shop default and the experiment Audience-step threshold.
- Metric: **revenue per visitor vs control**, worst challenger arm.
- Evaluate only after **100 visitors** on control and that arm.
- On breach: **pause** the test, write `guardrail_config.breached_at`, inbox → `paused` (not winner_ready).
- Do **not** block launch on projected revenue drop.

## Why this plan

Price-band guardrails already protect catalog prices at plan time. They do not protect live checkout revenue (especially offer discounts). Absolute dollar limits fail across currencies and SKU mix. RPV vs control is the same unit merchants already see on Performance.

Waiting for the wizard’s 5,000-visitor significance sample would let a collapse run too long. 100 visitors is enough to stop obvious damage without firing on the first few orders.

## Files

- `server/src/services/smartPricing/smartPricingRevenueGuardrail.js`
- `server/src/services/smartPricing/smartPricingGuardrailEvaluatorService.js`
- Settings → Guardrails, Audience step, Review, Performance, Settings tab
