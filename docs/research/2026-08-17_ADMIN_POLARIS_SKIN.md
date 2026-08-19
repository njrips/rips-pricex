# Admin / Polaris skin — research plan

**Date:** 2026-08-17  
**Status:** Implemented (2026-08-17) — Classic layout; Admin / Polaris visual on all product UI  
**Ask:** Keep the **current layout and information architecture**, but restyle the product so it uses **Shopify Admin panel UI and color combination** and feels like an internal Shopify project.

**Decisions locked (implementation):**
1. EchoTest orange unlocked as visual source — layout stays Classic.  
2. Public site uses the same Admin gray / near-black scheme (no marketing orange exception).  
3. Primary fill = Polaris `--p-color-bg-fill-brand` `#303030` (not green).  
4. Phase 1 tokens + Phase 2 Polaris controls shipped (list, wizard fields, Setup, Settings, welcome, review). IndexTable rewrite deferred.

**Pass 2 (2026-08-17):** Audit found leftover Classic `.input` / `.callout` / `.primaryBtn` on Setup, Settings, welcome, create-lock, wizard steps 1/2/4, and review badges. Converted those to Polaris `TextField` / `Select` / `Banner` / `Button` / `Badge`. Native leftover fields (pricing table, variation rows) use Admin-density CSS (32px / 8px / white surface).

**Pass 3 (2026-08-17):** Goal picker modal create/browse forms → Polaris fields + buttons. Details Performance pager, Variations preview/QR/expand, and list footer → Polaris `Button`. Filter pills use Admin selected gray (not brand-as-orange).

**Pass 4 (2026-08-17):** Removed invalid Polaris `TextField` `prefix` node (Polaris 13 expects a string). Products step browse/show-all and wizard/details back links → Polaris `Button`. Wizard card padding 33→20; leftover EchoTest success hex and warm-brown shadows → Admin green / black.

**Pass 5 (2026-08-17):** `--classic-cream` is canvas `#f1f1f1` — leftover rules still used it as a **white surface** or **button label**. Remapped those fills to `--classic-card` / `#ffffff` (page + list canvases stay cream). Fixed Settings / Targeting `:global([data-palette='admin'])` selectors that matched the **app wrapper** (gradient clip + orange checkmark leaked). Flattened Settings title/shell to Inter + 8px white card. Variations table Open → slim Polaris `Button`. Dark country dropdown leftover orange → Admin gray.

**Pass 6 (2026-08-17):** Demoted list/overview H1s (30/24 → 20px) so TitleBar stays the page title; muted EchoTest eyebrow tracking. List search → Polaris `TextField`. Overview more-menu trigger → `Button`. Settings price-surfaces (bare path) leftover Classic callout/input → `Banner` + `TextField`. Flattened Targeting `priceSurfacePanel` glass (16px + radial) to Admin 8px white card. Public hero 33→20; display type 30→24.

**Pass 7 — finish (2026-08-17):** Remaining standalone toolbars converted: product-picker / goal-picker close + searches; Performance / Variations / Products search+sort+pager; list row more-menu; review Edit / Setup links. Price-surface nested cards and Settings section icons flattened to 8px. Public preview eyebrow tracking muted. Phase 2 control language is complete.

**Pass 8 (2026-08-17):** Products toolbar `.tableCategorySelect` still had native-`<select>` chrome (extra border + chevron) after the Polaris wrap — stripped to a width wrapper. Toolbar Polaris fields lose Labelled margin. Warm `#e5e1de` / cream table-row borders → Admin `#e3e3e3`. Goal picker library links → `Button variant="plain"`.

**Pass 9 (2026-08-17):** Setup / Audience AI actions → Polaris plain `Button`. Variations name/description → `TextField`; Remove / Add variation → `Button`. Last cream variant-row border → Admin line. Variation cards 6→8px.

**Pass 10 (2026-08-17):** Button rhythm — icon/label gap 4px; button groups 8px; icon-only pager/more padding squared; modal Close label (not ×); public CTA padding 6×12. Polar icons `display:block` so labels sit on the optical center.

**Pass 11 (2026-08-17):** Stopped `display:block` on every Polaris button SVG (it flattened loading spinners). Icon-only 28px padding only on pager + list row more — not the details More control (it sits next to medium Pause / Roll out). Banner dismiss is a 28px centered hit target.

**Pass 12 (2026-08-17):** Goal picker tabs/body inset 16px (was 22) and 32px tab height. More-menu items 28×8 Admin rows. Leftover EchoTest success banner border → token. Ghost/button inner gap 4px.

**Pass 13 (2026-08-17):** Native chips/segments/tabs on the Admin 32×8 button grid — flex-centered labels, 4px icon/label gap. Leftover 34–42px ghost/browse/add rules neutralized so they cannot regress. Settings Polaris buttons no longer lift on hover. Price-surface scope tabs use the same 28×12 pill rhythm as group tabs.

**Pass 14 (2026-08-17):** Icon+label Polaris buttons (New experiment, Back, Continue, Pause, Roll out, browse) use the `icon` slot instead of a nested flex span inside `Button__Text` — that mixed baseline was shifting the label. `Button__Text` is now line-height 1 / flex-centered; icon/label gap is 4px.

**Pass 15 (2026-08-17):** Standard button icons → `@shopify/polaris-icons` (Plus, arrows, search, pause, external, more) so they fill the 20px Admin slot. Custom rocket/trophy/QR/hand-pick still used, but now forward `className` onto the SVG (no nested span). Overview + list-row More are icon-only `icon` buttons. Leftover warm `#cfc9c4` price hover and EchoTest success hex → Admin tokens. Goal picker tabs flex-centered.

**Pass 16 — finish (2026-08-17):** Browse / Show all lost their compact left-align class after the Polaris wrap, so they stretched and the label looked off-center. Restored `.compactAction` (fit-content, left, 8px above). Button labels use **20px line-height** to match the icon slot (the old `line-height: 1` was for nested spans). Show-all uses Polaris `SelectIcon`.

**Finished leftover inventory (locked — do not convert):**
- Pricing-table cells, variation-row name/price, bulk/AI 24px toolbar fields (density).
- Collection / category chips, group tabs, filter pills, country multi-select (Classic layout).
- Public CTAs (no `PolarisAppProvider` on public).
- Storefront picker chrome (`storefront-script.js`).
- IndexTable / `s-page` rewrite (Phase 3, gated).

**Related:** [00_PRODUCT_BRIEF.md](./00_PRODUCT_BRIEF.md) · [CLASSIC_FIGMA_DELTA.md](./CLASSIC_FIGMA_DELTA.md) · [RIPSPRICEX_IMPLEMENTATION_PLAN.md](./RIPSPRICEX_IMPLEMENTATION_PLAN.md) §3 + §12.2 · Shopify [Visual design](https://shopify.dev/docs/apps/design/visual-design) · [Polaris color tokens](https://polaris.shopify.com/design/colors/color-tokens)

---

## 1. Verdict (what this work is)

This is a **skin + control-language** change, not a product rewrite.

| Keep (layout / IA) | Change (Admin feel) |
|--------------------|---------------------|
| Routes and App Nav: Experiments · Create · Setup · Settings | Cream / orange EchoTest palette → Admin gray / white / semantic color |
| Create wizard: 5 steps, field order, copy | DM Sans → Inter (Admin typeface) |
| List cards, details tabs, Settings sections | 20px “consumer SaaS” radius → Admin 8–12px |
| TitleBar + NavMenu (already native) | Orange as **brand** → orange only as **warning / in-progress** |
| Public page structure (/, /faq, /privacy, …) | Same Admin gray / near-black (no orange marketing split) |

The original blueprint already named this as **v1.1**: “Body → Polaris Page / IndexTable / Banner / Modal” after MVP chrome ([RIPSPRICEX_IMPLEMENTATION_PLAN.md](./RIPSPRICEX_IMPLEMENTATION_PLAN.md) §12.2). This plan makes that path concrete **without** changing screen structure.

**Locked-decision conflict:** Track C and the product brief treat EchoTest cream/orange/DM Sans as the Classic visual contract. Proceeding requires an explicit unlock: **layout stays Classic; pixels follow Admin.** Do not treat this as a silent override of Figma fidelity.

---

## 2. Why it currently does not feel like Admin

The app is already **embedded** correctly. The body still looks like a third-party product.

```
Shopify Admin (gray, Inter, native nav)
  └── App iframe
        ├── App Bridge NavMenu + TitleBar     ← already Admin
        └── Classic body (cream, orange, DM Sans, 20px cards)
              └── a few Polaris Banner / Card / TextField islands
```

| Layer | Today | Admin target |
|-------|--------|--------------|
| Chrome | App Bridge `NavMenu` + `TitleBar` | Keep |
| Wrapper | `PolarisAppProvider` + `@shopify/polaris` **13.9.5** | Keep; use tokens, not just the provider |
| Palette hook | `data-palette="orange-classic"` on `app.tsx`, `PageShell`, public shell | New `admin` / `polaris` palette (or drop the attribute) |
| Tokens | `--classic-cream #fefbf8`, `--classic-orange #f16a1a` in `SmartPricingClassic.module.css` + `classic-theme.css` | Map onto `--p-color-*` semantic tokens |
| Type | Google Fonts **DM Sans** | **Inter** (Admin); system fallback already listed |
| Density | 15px body, 30px display, large paddings | 13px min interactive / body; 12px captions ([visual design](https://shopify.dev/docs/apps/design/visual-design)) |
| Mixed UI | Settings / price surfaces / winner modal already import Polaris; Classic list/wizard do not | One language |

Hardcoded EchoTest color is concentrated: ~100 hits in `SmartPricingClassic.module.css`, plus `classic-theme.css`, `public-classic.css`, `Settings.module.css`, and the boot splash in `app/routes/app.tsx`.

---

## 3. What “Shopify Admin UI and color combination” actually means (2026)

Official App Home guidance: merchants cross between **Products / Orders / Settings** and your app; the cheapest way to feel native is **Polaris**, not a custom brand theme.

### 3.1 Color roles (do not invent a new brand green)

Admin uses a **neutral canvas**. Color is semantic, not decorative ([visual design — Color](https://shopify.dev/docs/apps/design/visual-design)):

| Role | Use | Do not use for |
|------|-----|----------------|
| Neutral black / dark gray | Most text, primary actions in current Admin | Decoration |
| Green | Success, completed | Enticing CTAs / “brand” |
| Yellow | Caution, incomplete, attention (not urgent) | Announcements |
| **Orange** | In-progress, pending, strongest non-blocking warning | **App identity / primary buttons** (this is the current Classic mistake) |
| Red | Blocked, error, impossible | Marketing emphasis |

That last row is the core research finding: **Classic orange `#f16a1a` as the primary button and selected-step color fights Admin.** In Admin, orange means “needs attention,” not “this is our product.”

### 3.2 Surfaces (the Admin “color combination”)

Polaris semantic tokens (apply via CSS variables once `PolarisAppProvider` is mounted):

| Intent | Typical token | Classic today |
|--------|---------------|---------------|
| App canvas | `--p-color-bg` (cool gray, ~`#f1f1f1` / `#f6f6f7`) | `--classic-cream` `#fefbf8` (warm) |
| Card / panel | `--p-color-bg-surface` | `--classic-card` `#ffffff` (OK) |
| Text | `--p-color-text` | `--classic-ink` `#231814` (warm brown-black) |
| Subdued text | `--p-color-text-secondary` | `--classic-muted` `#6e605a` |
| Line | `--p-color-border` | `--classic-line` `#e9e3df` (warm) |
| Primary fill | `--p-color-bg-fill-brand` (or current Admin near-black fill) | `--classic-orange` |
| Success | `--p-color-bg-fill-success` / text-success | `--classic-success` `#3fb171` |
| Critical | `--p-color-text-critical` | scattered reds |
| Warning / in-progress | `--p-color-bg-fill-warning` (orange family) | same orange used as brand |

**Research task before coding:** screenshot live Admin (Products list, order detail, Settings) on a 2026 shop and compare to Polaris 13 defaults. Admin has been moving toward **monochrome primary buttons**; Polaris 13 still exposes a **brand/green** fill. Pick whichever matches the merchant’s Admin **this year**, not a 2022 green-button memory.

### 3.3 Type, space, chrome

- Font: **Inter** (variable); system UI for missing glyphs. Drop the DM Sans `@import` in `classic-theme.css` for the embedded app.
- Min 13px body / controls; 12px captions.
- Icons: Polaris icon set, used consistently in repeating rows.
- Page title: TitleBar is already the largest heading — avoid a second 30px Classic H1 that competes ([CLASSIC_FIGMA_DELTA.md](./CLASSIC_FIGMA_DELTA.md) already flags this).
- Contrast: 4.5:1 text-on-background (WCAG AA). Warm cream + orange fails less often than low-contrast gray-on-gray — re-check after the remap.

### 3.4 Two Shopify UI stacks (do not mix blindly)

| Stack | In this repo | Role |
|-------|----------------|------|
| **Polaris React 13** | `@shopify/polaris` + `PolarisAppProvider` in `app/routes/app.tsx` | Current, already paid for |
| **App Home web components** (`s-page`, `s-button`, …) | Mentioned in the blueprint; not adopted in Classic bodies | Newest Admin-identical controls |

**Recommendation for this plan:** stay on **Polaris React 13 + token remap** for the first pass. A web-component rewrite is a later track (layout risk is higher).

---

## 4. Recommended approach (phased)

Goal: **same boxes, Admin paint.** Do not rebuild the wizard as `Polaris Page` + `IndexTable` on day one.

### Phase 0 — Unlock + reference (research only)

1. Confirm the product decision: **Classic layout, Admin pixels.** Update [00_PRODUCT_BRIEF.md](./00_PRODUCT_BRIEF.md) when implementation starts (not before).
2. Capture a **side-by-side board**:
   - Live Admin: Home, Products, an order, Settings.
   - RipsPriceX: Experiment list, Create step 3, Details Overview, Settings → Plan, public `/`.
3. Write a token table (Classic → `--p-color-*`) with hex snapshots from the live Admin CSS (DevTools on `admin.shopify.com`).
4. Decide public-site policy (see §5).

**Exit:** this doc updated with a filled token table + screenshots (or links) + a written unlock in the brief.

### Phase 1 — Token remap only (layout-identical)

Introduce `data-palette="admin"` (keep `orange-classic` as a fallback for rollback).

Remap in **one place** so JSX and CSS class names stay:

| Classic variable | Admin mapping (draft — verify in Phase 0) |
|------------------|-------------------------------------------|
| `--classic-cream` | `--p-color-bg` |
| `--classic-card` / `--classic-table-row` | `--p-color-bg-surface` |
| `--classic-wash` / `--classic-track` / table head | `--p-color-bg-surface-secondary` |
| `--classic-ink` / `--classic-body` | `--p-color-text` |
| `--classic-muted` | `--p-color-text-secondary` |
| `--classic-line` | `--p-color-border` |
| `--classic-orange` (buttons, selected step, links) | `--p-color-bg-fill-brand` **or** `--p-color-bg-fill` (primary) |
| `--classic-orange-soft` | `--p-color-bg-surface-selected` / brand-secondary |
| `--classic-orange-deep` | `--p-color-text-brand` / `--p-color-text-inverse` on fills |
| `--classic-success*` | success tokens |
| `--classic-radius` `20px` | `8px` (cards) / `8px` or `6px` (controls) |
| `--classic-radius-sm` `12px` | `6px` |
| `--ripx-font-classic` | Inter, `'Inter', -apple-system, BlinkMacSystemFont, 'San Francisco', 'Segoe UI', Roboto, sans-serif` |

Also restyle the **boot splash** in `app/routes/app.tsx` (still hardcodes `#FAF7F2` / `#f16a1a`).

**Do not** change component trees. This is the cheapest way to keep “layout the same.”

**Exit:** list + wizard + details look Admin-gray; a merchant flipping from Products → app does not see a cream flash.

### Phase 2 — Control language (still same layout)

Replace **controls** that already fight Polaris islands, without changing page skeletons:

| Keep Classic shell | Swap control to Polaris |
|--------------------|-------------------------|
| `ClassicExperimentsList` page grid | `Badge`, `Button`, `EmptyState`, `Banner` |
| Wizard step panels | `TextField`, `Select`, `Checkbox`, `Banner` |
| Details tabs | `Badge` for status; keep custom tab row **or** Polaris `Tabs` if the tab strip geometry stays |
| Settings (already partial Polaris) | Finish the conversion so Settings is not half-cream |
| `WinnerApplyModal` | Already Polaris `Modal` — drop remaining Classic color overrides |

**Do not** replace the 5-step rail, product pricing table, or experiment card grid with `IndexTable` in this phase — that **is** a layout change.

**Exit:** primary/secondary buttons, banners, and form fields match Admin; custom layout chrome remains.

### Phase 3 — Optional native layouts (only if Phase 2 still feels “off”)

Only after a live review:

- Experiment list → Polaris `IndexTable` / `ResourceList` **if** the card grid is the remaining “not Shopify” cue.
- Wizard → `s-page` / Polaris `Page` + `Layout` two-column **if** TitleBar + in-page stepper still double-chrome.
- This phase **may** change layout. Gate it; it is out of the original ask.

---

## 5. Scope split (do not skin everything the same)

| Surface | Recommendation | Why |
|---------|----------------|-----|
| **Embedded Admin** (`/app/*`) | Admin skin (Phases 1–2) | Merchants compare this to Products/Orders |
| **Public marketing** (`/`, `/faq`, …) | **Same Admin gray / near-black** (locked) | Product decision: feel internal everywhere |
| **`/auth/login`** | Same Admin palette via public shell, `noindex` | Tiny; must not look cream/orange |
| **Storefront script / theme embed** | Out of scope | Customer-facing; must not look like Admin |
| **App icon** | Separate App Store spec (1200², not Shopify logo) | [Visual design — App icon](https://shopify.dev/docs/apps/design/visual-design) |

All product UI shares `--classic-*` aliases from `admin-polaris-tokens.css` (Polaris 13 hex fallbacks).

---

## 6. Risks

| Risk | Mitigation |
|------|------------|
| Breaks the EchoTest Figma lock (Track C) | Written unlock in the product brief; keep `orange-classic` palette for rollback / screenshot diffs |
| Orange primary = Admin “warning” | Never use `#f16a1a` for Launch / Create / selected step after Phase 1 |
| Polaris 13 ≠ 2026 Admin (black buttons vs green) | Phase 0 live Admin screenshot before locking primary fill |
| CSS module hydrate dropping styles | Same lesson as public CSS: prefer **global token file** + pinned `?url` links; do not introduce a new CSS-module `?url` |
| Radius-only leftover | If colors change but 20px / 32px padding stay, it still looks like a consumer SaaS. Phase 1 **must** include radius + type |
| Double titles (Classic H1 + TitleBar) | Phase 1 or 2: demote in-page titles where TitleBar already names the page |
| Accessibility after gray remap | Contrast pass on muted text and selected-step chips |
| Scope creep into IndexTable / web components | Phase 3 is gated |

---

## 7. Research tasks (checklist)

Work these **before** a large CSS PR.

1. **Inventory** every `--classic-*` and hardcoded `#f16a1a` / `#fefbf8` / `#FAF7F2` / DM Sans (Admin vs public vs splash).
2. **Reference board:** screenshot Admin + each major RipsPriceX screen (list, wizard ×5, details, setup, settings, public home).
3. **Token table:** fill §4 Phase 1 with live `--p-color-*` computed values from Admin + from Polaris 13 in this app.
4. **Primary-action decision:** brand-green vs near-black fill (match 2026 Admin, not nostalgia).
5. **Public-site decision:** keep orange marketing vs gray.
6. **TitleBar vs in-page H1:** list pages that double-title today.
7. **Component audit:** which Classic buttons/fields can become Polaris in Phase 2 without moving boxes.
8. **A11y:** contrast for new muted gray on `#f1f1f1`.
9. **Rollback:** `data-palette="orange-classic"` still works after the token file split.
10. **Unlock brief:** one paragraph in `00_PRODUCT_BRIEF.md` when implementation is approved.

**Prototype (optional, still research):** one screen (Experiment list) behind `data-palette="admin"` on a feature branch. If the list still feels foreign, the leftover is radius/type/buttons — not “we need to rebuild the wizard.”

---

## 8. Success criteria

A merchant who just left **Products** and opens RipsPriceX should notice:

- Same gray canvas and white cards  
- Same Inter and control height  
- Same meaning of green / yellow / orange / red  
- Same primary button language as Admin  

They should **not** notice:

- A different sitemap, wizard order, or missing fields  
- A cream flash on load  
- Orange “brand” buttons that look like Admin warning chips  

**Non-goals:** storefront paint, cart transform, billing IA, public legal copy, Figma pixel-match to EchoTest.

---

## 9. Suggested implementation order (when approved)

1. `classic-theme.css`: add `[data-palette='admin']` token block; stop loading DM Sans on `/app`.
2. `app.tsx` / `PageShell`: switch embedded wrappers to `data-palette="admin"`; restyle boot splash.
3. Leave `SmartPricingClassic.module.css` class structure; only token values change.
4. Settings + remaining Polaris islands: remove cream overrides.
5. Phase 2 control swaps, screen by screen (list → wizard → details).
6. Public site: no change unless §5 says otherwise.
7. Update Track C / brief: Figma is **layout source**, Admin is **visual source**.

---

## 10. Decisions needed from you

1. **Unlock** EchoTest orange as the visual source of truth? (Layout stays.)  
2. **Public site:** keep cream/orange marketing, or gray it too?  
3. **Primary button:** match live Admin (likely near-black) or Polaris brand green?  
4. **How far:** Phase 1 tokens only, or Phase 1+2 controls in the first build?

No code in this pass. Implementation starts only after those four answers.
