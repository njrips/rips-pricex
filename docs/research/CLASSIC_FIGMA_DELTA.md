# Classic Smart Pricing vs EchoTest Figma

**Date:** 2026-08-10  
**Figma:** [EchoTest](https://www.figma.com/design/4ZiENSDNrhaAOawOSqGZ6C/EchoTest?node-id=13-4072&m=dev) (`4ZiENSDNrhaAOawOSqGZ6C`)  
**Linked node:** `13:4072` — Create wizard **Step 4 / Audience & success** (inside `Create New Experiment/Step 4/ Audience Setup`)  
**Page:** `Final` (`0:1`)

---

## Verdict

| Layer | Status | Notes |
|-------|--------|--------|
| Create wizard structure (5 steps) | ✅ Matches Figma | Same labels/subtitles as `CLASSIC_CREATE_STEPS` |
| Audience step fields (node 13:4072) | ✅ Matches Figma | Segment, traffic %, primary/secondary metrics, guardrails table, advanced (sample size, device, source, countries) |
| Experiment list + Step 1–3 / 5 frames | ✅ Ported in Classic pack | Present in Figma + `classic/*` panels |
| Details Overview (+ tabs) | ✅ Structure ported | Figma has Overview; code has 7 tabs |
| Pixel / visual polish vs Figma | ⚪ Unlocked | Layout stays Classic; pixels follow Admin / Polaris (2026-08-17). See [2026-08-17_ADMIN_POLARIS_SKIN.md](./2026-08-17_ADMIN_POLARIS_SKIN.md) |
| Live storefront E2E | 🔬 Separate from design | Embed + cart transform + paint still must be proven on `ripx-plus` |

**Conclusion:** For Classic Smart Pricing **admin UX**, the EchoTest design is **implemented as the Classic pack** (wizard + list + details). RipX functional parity for the price-test spine is documented in [RIPX_SMART_PRICING_PARITY.md](./RIPX_SMART_PRICING_PARITY.md). It is **not** “App Store finished” until live E2E + billing + any pixel deltas you care about are closed. The linked Figma node alone is **Audience step**, not the whole product — but the file’s `Final` page contains the full create/details set listed below.

---

## Figma screen inventory → code

| Figma frame | Approx. node | RipsPriceX |
|-------------|--------------|------------|
| Experiment Dashboard | `13:3` | `ClassicExperimentsList.jsx` → `/app` |
| Create Step 1 | `13:305` | `SetupStepPanel.jsx` |
| Create Step 2 | `13:544` | `VariationsStepPanel.jsx` |
| Create Step 3 (manual / AI / all products / modal variants) | `13:797`, `13:1495`, `13:2193`, `60:9176`, `13:3437` | `ProductsPricingStepPanel.jsx` + `ClassicProductPickerModal.jsx` |
| Create Step 4 Audience Setup | `13:4071` / content `13:4072` | `AudienceSuccessStepPanel.jsx` |
| Create Step 5 Review | `13:4501` | `ReviewLaunchStepPanel.jsx` |
| Experiment Details / Overview | `13:4884` | `ClassicExperimentOverview.jsx` + `details/ClassicOverviewTab.jsx` |
| Experiment Details / Audience | `245:350` | `details/ClassicAudienceTab.jsx` |
| Experiment Details / Metrics | `245:609` | `details/ClassicMetricsTab.jsx` |
| Experiment Details / Activity | `245:853` | `details/ClassicActivityTab.jsx` |

Details tab layout (2026-08-20, EchoTest Final page — colors stay Admin / Polaris):

- **Audience** (`245:350`): 2×2 fact cards — Segment, Traffic allocation, Devices, Countries. Country values are ISO alpha-2 codes (`US, CA`), not full names. Draft **Edit targeting / Adjust / Edit** resumes the wizard at Audience. After launch those actions open the Settings tab (read-only extras + guardrails). Settings repeats Countries as codes.
- **Metrics** (`245:609`): stacked Primary + Secondary cards. Guardrails/COGS moved to the Settings tab (not on this Figma frame).
- **Activity** (`245:853`): one **Activity history** card, newest-first timeline (`title` + `owner · timestamp`).
- Performance / Variations / Settings are tabs on those frames, not separate Figma screens. Settings holds targeting extras + guardrails that the simplified Audience/Metrics layouts no longer show.
- **Variations** preview: only the clicked Preview / QR / Open control shows a spinner. Sibling variation cards share one product/plan, so busy state is keyed by arm + action. Other preview controls disable until that request finishes. Offer Preview / QR / Copy open the storefront PDP (`ab_preview_test_type=offer`), not the price-preview bootstrap API URL.

Page chrome alignment (2026-08-20):

- Details / Create / Setup / Settings TitleBar uses App Bridge `variant="breadcrumb"` **Experiments** (not a React Router `Link`, which sat in the action slot).
- In-page **← Experiments** is a flush-left breadcrumb with **16px** above and below (same as wizard **Back to experiments** / footer Back). Polarise 13 plain buttons use padding + a matching **negative margin**; Classic chrome zeros both so the arrow lines up with the title, tabs, cards, review Edit, and list footer. Continue uses `flex-direction: row-reverse` (Polarise 13 has no `Button__Content` wrapper).
- List **New experiment** sits on the title row, not vertically centered against the subtitle. List banners use the same 32px inline inset as `.listPage`.

Wizard step copy in code matches Figma steppers:

1. Setup — Name & type  
2. Variations — Traffic split  
3. Products — Pick & price  
4. Audience — Choose Audience / Audience & success  
5. Review — Launch  

---

## Step 4 deep check (linked node)

Figma controls vs `AudienceSuccessStepPanel.jsx`:

| Figma control | In code |
|---------------|---------|
| Back to experiments | ✅ Wizard shell |
| Step 4 of 5 + 5-step rail | ✅ `ClassicWizardShell` + `CLASSIC_CREATE_STEPS` |
| Audience segment | ✅ |
| Traffic allocation slider + % copy | ✅ |
| Primary success metric | ✅ (+ goal picker modal) |
| Secondary metric pills | ✅ |
| Guardrail table (metric / rule / threshold / On) | ✅ Same default rows as Figma |
| Advanced: min sample, device, traffic source, countries | ✅ (+ include/exclude toggles beyond Figma in places) |
| Back / Continue | ✅ |

Minor deltas (acceptable unless you want pixel lock):

- Shopify Admin chrome (App Nav / TitleBar) instead of EchoTest left nav  
- Default primary metric in code defaults may differ from Figma mock (“Paid conversion rate” vs code default `revenue_per_visitor`) — verify desired default  
- Guardrail **runtime enforcement** (alert/auto-stop) may be UI-first; confirm backend wiring before promising auto-stop  

---

## Gaps to treat as product work (not “missing screens”)

1. **Live E2E** — theme embed, cart transform, PDP paint, apply winner on `ripx-plus`  
2. **Visual fidelity pass** — side-by-side screenshot review of Steps 1–5 + Dashboard + Overview (Track C)  
3. **Goals & Metrics** — still partly Settings/guardrails rather than a standalone Goals page  
4. **Billing chrome** — locked Create / upgrade must match Shopify App Pricing, not only `DEV_ENTITLE_ALL`  

---

## Recommended next research actions

1. Screenshot Steps 1, 2, 3, 5 + Dashboard + Overview from Figma; compare to running app on `ripx-plus`  
2. Decide must-fix pixel list vs “accept Shopify shell deltas”  
3. After E2E pass, mark Track C exit in `05_FURTHER_RESEARCH_ROADMAP.md`  
