export const DOCS_UPDATED = 'August 29, 2026';

export const DOCS_HERO = {
  eyebrow: 'GUIDES',
  title: 'How Pricify tests stay safe and statistically valid.',
  subtitle:
    'Shop Settings store the defaults for new experiments. Info icons in Admin open the matching section here — including how AI Suggest calculates a test price.',
};

export const DOCS_NAV_CARDS = [
  {
    href: '#price-safety',
    label: 'Guide 01',
    title: 'Price safety',
    body: 'Caps on how far a test price can move, and when a live test pauses itself.',
  },
  {
    href: '#statistics',
    label: 'Guide 02',
    title: 'Confidence and sample size',
    body: 'How 90% confidence, target lift, and sequential testing work together.',
  },
  {
    href: '#enforced',
    label: 'Guide 03',
    title: 'What is enforced',
    body: 'The revenue-per-visitor pause rule stamped onto a new experiment.',
  },
  {
    href: '#ai-pricing',
    label: 'Guide 04',
    title: 'AI price suggestions',
    body: 'How Suggest picks a test price inside your band, then clamps it to shop guardrails.',
  },
];

export const DOCS_GROUPS = [
  {
    id: 'price-safety',
    eyebrow: 'PRICE SAFETY',
    title: 'Caps that protect catalog price and live revenue.',
    tone: 'deep',
  },
  {
    id: 'ai-pricing',
    eyebrow: 'AI PRICING',
    title: 'How Suggest picks a test price.',
    tone: 'plain',
  },
  {
    id: 'statistics',
    eyebrow: 'STATISTICS',
    title: 'Confidence, lift, and sequential calls.',
    tone: 'plain',
  },
  {
    id: 'enforced',
    eyebrow: 'ENFORCEMENT',
    title: 'What actually pauses a test.',
    tone: 'deep',
  },
  {
    id: 'offer-tests',
    eyebrow: 'OFFER TESTS',
    title: 'How offer prices show on the product page and at checkout.',
    tone: 'plain',
  },
];

export const DOCS_SECTIONS = [
  {
    id: 'how-settings-work',
    group: 'price-safety',
    title: 'How Settings apply',
    paragraphs: [
      'Guardrails and experiment defaults on Settings apply to new suggestions and new launches. A running test keeps the values stamped at launch so mid-test edits in Settings do not rewrite its statistics.',
      'Create still lets you change minimum sample size, traffic, and audience for that experiment.',
    ],
  },
  {
    id: 'max-price-change',
    group: 'price-safety',
    title: 'Max price change',
    paragraphs: [
      'This is the widest a test price may move from the current catalog price, typically 3–30%. It is a hard cap for AI Suggest and for plan build — the min–max band on Products cannot be set past it, and the Products step links back here (or offers to raise it in one click) when you try.',
    ],
  },
  {
    id: 'max-revenue-drop',
    group: 'price-safety',
    title: 'Max revenue drop',
    paragraphs: [
      'Always on for price and offer tests. After each variation has about 100 visitors, Pricify compares revenue per visitor to control. If any challenger drops more than this percent, the test pauses and assignment stops.',
      'An experiment can set a tighter revenue row on the Audience step. The effective limit is the stricter of the shop default and that row.',
    ],
  },
  {
    id: 'min-margin',
    group: 'price-safety',
    title: 'Min margin',
    paragraphs: [
      'Suggested prices stay above the minimum margin when unit cost is known. This check runs at plan time and when AI Suggest clamps a price — it is not a live pause rule.',
    ],
  },
  {
    id: 'default-cogs',
    group: 'price-safety',
    title: 'Default COGS',
    paragraphs: [
      'Default COGS is used when a product has no unit cost. Margin checks and AI Suggest then use that assumed cost. This is a plan-time check, not a live pause rule.',
    ],
  },
  {
    id: 'ai-price',
    group: 'ai-pricing',
    title: 'AI price suggestions',
    paragraphs: [
      'On the Products step, choose AI suggested, set a min–max band as a percent or a dollar amount, then click Suggest. Control stays at the catalog price. Every selected product × test variation gets a suggested price. You can still edit any cell before launch.',
      'Suggest fills higher test prices only — the band is an increase from the catalog price, not a discount. A dollar band is the same cash increase on every product: $4–$8 adds $4–$8 whether the product sells for $20 or $200. Each product is still capped on its own by your price safety settings, so a flat dollar uplift never pushes a cheap product past your max price change.',
      'When AI is available, it proposes an increase inside your min–max for each product × variation. Higher-opportunity or stronger-margin products get larger lifts; thin-margin products get quieter ones. The model sees current price, 30-day units, opportunity score, and your shop max price-change and min-margin settings. It does not invent products or variation ids.',
      'Each lift becomes a price: catalog × (1 + lift%), rounded to cents (whole yen for JPY). Shop max price change is a hard cap, and the band cannot be set past it: with the cap at 16%, typing 30% holds the field at 16% instead of accepting a number that could never be used. The Products step then says what you entered and offers two ways out — raise the cap to cover it in one click, or open Settings → Price guardrails directly (Settings allows up to 30%). Raising the cap puts your original number back in the band. A dollar band is capped the same way, converted at the average price of the products you selected. A second floor uses catalog margin from unit cost when known, otherwise Default COGS, so the suggestion does not collapse toward cost.',
      'Variations are spread across the full band instead of bunched near its middle. With a 10–20% band, three variations test 10%, 15%, and 20%. Prices that sit only a point or two apart cannot be told apart at realistic store traffic, so spanning the band is what makes the result readable. A single test variation sits mid-band.',
      'If a product\u2019s margin floor forces a price under your band minimum, Pricify says how many prices that affected instead of quietly showing a smaller increase. If AI is unavailable or skips a product × variation pair, the same deterministic spread fills the gap, and if the request fails entirely the wizard applies that spread locally inside the same shop cap so the table is not left empty.',
    ],
  },
  {
    id: 'confidence',
    group: 'statistics',
    title: 'Confidence level',
    paragraphs: [
      '90% is the recommended default for pricing tests: enough protection against a false winner without forcing huge samples. 95% is stricter and needs more visitors for the same lift.',
      'Pricify stores this as confidence (0.90), not as alpha (0.10). Multi-variation planning adjusts that threshold across all challenger-versus-control comparisons.',
    ],
  },
  {
    id: 'target-lift',
    group: 'statistics',
    title: 'Target lift',
    paragraphs: [
      'Target lift is the smallest relative conversion improvement used by the fixed-horizon planning reference, usually 10%. A smaller target needs more visitors. This number also calibrates sequential evidence.',
      'It is a planning target, not a promise that every test will find that lift.',
    ],
  },
  {
    id: 'min-sample',
    group: 'statistics',
    title: 'Minimum sample and planning reference',
    paragraphs: [
      'Minimum sample is the earliest Pricify evaluates a result. The fixed-horizon planning reference is calculated from each product’s conversion rate, your target lift, confidence, configured power, and the number of challenger comparisons.',
      'Review shows a whole-week collection range only when current traffic can support a practical 2–8 week test. Longer calculations are labeled not feasible and replaced with the eligible visitors/day needed to reach the selected minimum by 8 weeks.',
      'For a new store without enough measured product traffic, shop-level traffic is only a low-confidence planning prior. AI may broaden the audience and raise experiment allocation, but it never lowers your minimum sample or invents a shorter statistically valid timeline.',
      'Minimum sample is a visitor count, and visitors alone do not decide a price test — conversions do. Minimum conversions per variation is the second floor, and both must be met.',
    ],
  },
  {
    id: 'min-conversions',
    group: 'statistics',
    title: 'Minimum conversions per variation',
    paragraphs: [
      'No winner is called until every variation has reached this many conversions, however many visitors it has seen. It sits alongside minimum sample: a result needs both the visitors and the conversions.',
      'Visitors are the wrong unit for the decision. A price test compares conversion rates and revenue per visitor, and both are driven by order counts. 5,000 visitors per variation sounds substantial, but at a 0.4% conversion rate that is 20 orders — and at 20 orders a +40% lift can appear and then vanish as the test continues. That is regression toward the mean, not a price effect.',
      'The floor is also what makes the statistics valid rather than merely tidy. The confidence figure comes from a normal approximation whose variance estimate needs a minimum number of conversions per arm; below roughly 10 the number is not conservative, it is wrong. Pricify therefore enforces at least 10 per variation regardless of this setting, and Settings accepts 10–2000.',
      'This is not a substitute for planning. The required sample still comes from your conversion rate, target lift, confidence, and power — a fixed conversion count cannot replace that calculation. The floor exists to stop an early sequential call from being made on a handful of orders.',
      'The default is 100, which is what 5,000 visitors produces at the 2% baseline the planner assumes, so the two defaults describe the same test. Review folds this floor into its timeline: when conversions take longer to accumulate than visitors, the collection window is quoted from the conversion floor and says so. The floor is stamped when a test launches, so changing it here never rewrites a running test.',
    ],
  },
  {
    id: 'traffic-split',
    group: 'statistics',
    title: 'Traffic split',
    paragraphs: [
      'On Variations, each arm gets a share of assigned visitors. Those shares must add up to 100%. Control is the catalog baseline. Use Split evenly for an equal test, or give a challenger more traffic when you already have a strong hypothesis.',
    ],
  },
  {
    id: 'sequential',
    group: 'statistics',
    title: 'Sequential evidence and winner review',
    paragraphs: [
      'Classic tests can be read at any time. A fixed-horizon p-value cannot: checking it repeatedly and stopping at the first good-looking moment inflates false positives well past the stated confidence. Pricify therefore reads results with a sequential boundary, which is built to be looked at continuously without that penalty.',
      'Two layers do the work. The directional layer is a mixture-SPRT and covers every metric, including revenue and profit per visitor. It estimates variance from running totals, and value metrics use an average-order-value proxy rather than order-level spread, so it is evidence to weigh rather than a decision to act on unattended.',
      'The confirming layer applies to conversion rate only, and it is exact. Randomised assignment means that if both prices convert equally, any given order came from the challenger with a probability fixed by the traffic split alone — the store’s actual conversion rate drops out of the arithmetic. That turns the order stream into a known coin, so the boundary needs no variance estimate, no normal approximation, and no minimum sample for its own validity.',
      'After the minimum sample and conversion floors, review each product’s evidence, traffic quality, effect size, and guardrail status. Roll out winner stays available on the directional read, so manual winner review per product is what releases anything the exact layer has not confirmed. Automatic catalog writes wait for that confirmation as well.',
    ],
  },
  {
    id: 'auto-apply',
    group: 'statistics',
    title: 'When a price is written automatically',
    paragraphs: [
      'Auto-apply writes a winning price to the Shopify catalog without asking. Because that is expensive to undo, every one of these has to hold: the metric is conversion rate, both sample floors are met, the exact boundary agrees with the directional one on the same winner, the traffic split matches the test’s allocation, no guardrail has been breached, and the test has run at least 14 days.',
      'The 14 days are about time rather than volume. A week carries its own shape — weekday and weekend shoppers do not behave alike — so a result measured over a single week can be a calendar artefact at any sample size. Two full cycles also give recent orders room to be cancelled or refunded before a price is committed.',
      'Revenue and profit per visitor never auto-apply. Their spread depends on order values, which vary far more than a yes-or-no conversion, and Pricify measures that spread with a proxy. A proxy is enough to inform your judgement and not enough to authorise an unattended price change.',
      'Each product decides on its own. One SKU reaching a verdict writes only that SKU’s price; its siblings keep running until their own evidence arrives. A control win ends that product with the catalog price untouched.',
      'Once all of that holds, a review window still runs before anything is written — three days by default, counted from the moment the product reached a decision and you were emailed about it. Set it to zero to apply as soon as the evidence lands, or raise it if you want longer to look. Applying a product yourself at any point during the window cancels the automatic write for it.',
    ],
  },
  {
    id: 'rollout-queue',
    group: 'statistics',
    title: 'Rollout queue and ready-to-apply alerts',
    paragraphs: [
      'An experiment covering ten products is ten independent tests. They almost never finish together: a high-traffic SKU can have a confirmed winner in a fortnight while a slower one is still weeks from its sample floor, and a third may be better off on its control price. Ending the whole experiment to act on the first is a false choice, and waiting for the slowest one costs you the lift you have already measured.',
      'The Performance tab therefore opens with a rollout queue: one row per product, ordered by what needs you rather than alphabetically. Products you can act on come first, then anything blocked by a traffic-split fault, then everything still collecting — with the ones nearest their floors ahead of the ones that just started. Each row names the price move, why the product is in that state, and how far along it is; opening a row shows the per-variation numbers and the evidence behind the call.',
      'Apply on a row writes that one product’s price and stops that one test. Apply all ready does the same for every finished product in one action, skipping anything still collecting or blocked, and reports separately on any that failed. A control win or a winning offer has no catalog price to write, so those rows finish the product instead. Either way the rest of the experiment keeps running.',
      'A product the revenue guardrail stopped is never offered for rollout. The guardrail fires because a variation lost money against control, so applying that price would act on the exact reading the guardrail rejected. Those rows say what the drop was and against which limit, and they stay on their original price — nothing was written to your catalog.',
      'You are emailed the first time each product reaches a decision, to your store’s Shopify contact address unless you set another in Guardrails. Products that cross over together are batched into one message, and each product is only ever mentioned once, so a slow-finishing experiment does not turn into a mailing list. If a message cannot be sent the products stay queued for the next attempt rather than being silently dropped. Turn the alerts off if you would rather check the queue yourself.',
    ],
  },
  {
    id: 'srm',
    group: 'statistics',
    title: 'Traffic split checks',
    paragraphs: [
      'Every result assumes visitors reached the variations in the proportions you set. Pricify checks that assumption continuously with a chi-square test against your allocation and flags a sample ratio mismatch when the observed split is more skewed than chance can explain, at the industry-standard threshold of p < 0.001.',
      'A mismatch is a data fault, not a close result. Common causes are bot traffic landing on one variation, a page cache serving one price more often, or assignment firing before the visitor is counted. Whatever the cause, the two groups are no longer comparable, so the lift between them is not measuring price.',
      'This is why a mismatch blocks rather than warns. Winner rollout is refused and no price is written automatically until the split is healthy. It also invalidates the exact conversion boundary specifically, because that boundary’s null is your designed split — if the real split is not the designed one, the test is answering the wrong question.',
    ],
  },
  {
    id: 'guardrail-metrics',
    group: 'enforced',
    title: 'Revenue guardrail',
    paragraphs: [
      'The Audience step keeps one operational guardrail: revenue per visitor. After each variation has about 100 visitors, Pricify compares the observed point estimate to control. If any challenger drops more than this percent, the test pauses and assignment stops. This reversible safety pause is heuristic, not statistical winner evidence.',
      'The threshold comes from Settings (Max revenue drop). You can tighten it on that experiment before launch. Other shop caps such as max price change and min margin stay on Settings — they are not extra Audience rows.',
    ],
  },
  {
    id: 'scenario-preset',
    group: 'enforced',
    title: 'Scenario preset and round 2',
    paragraphs: [
      'The default scenario preset seeds first-round candidate prices when Pricify builds a plan (conservative, recommended, or aggressive), still inside the max price-change band. The Products step AI Suggest banner uses your typed min–max band instead, then clamps to max price change and min margin.',
      'Auto-start round 2 is the shop default for whether a finished learning round may queue a follow-up. You can change it on that experiment before launch.',
    ],
  },
  {
    id: 'offers',
    group: 'offer-tests',
    title: 'Offer tests',
    paragraphs: [
      'On the Products step, set one offer per test variation. Control stays at the catalog price with no discount so you can measure the offer against the current price.',
      'Assigned shoppers see a sale cutout on the product page: catalog price struck through, the offer price beside it, and the offer message — or the offer amount if you left the message empty — under that cutout. Checkout applies the discount through the Pricify checkout function.',
      'Offer tests need that checkout function on Setup. Price paint still needs the theme app embed and a mapped PDP price selector.',
    ],
  },
];

export const DOCS_FAQ = [
  {
    q: 'Do Settings changes affect a running test?',
    a: 'No. Confidence, sample size, and revenue-drop limits are stamped on the test at launch. Change them in Settings for the next experiment, or edit that experiment before you launch it.',
  },
  {
    q: 'Why not set every test to 95% confidence?',
    a: '95% needs a much larger planning sample for the same lift. The 90% default is a practical planning trade-off, but current sequential evidence remains directional and requires manual winner review.',
  },
  {
    q: 'Will Pricify invent a 2% conversion rate?',
    a: 'No. A planning reference is calculated only from a qualified product conversion rate. If traffic is missing, Pricify does not show a timeline; if a new-store traffic prior is available, Review labels it low-confidence and never presents an impractical multi-year result as a forecast.',
  },
  {
    q: 'Does Suggest change my catalog price?',
    a: 'No. It only fills higher test-variation prices in the wizard. Control stays at the catalog price. A Shopify catalog price changes only after you review the result and explicitly roll out that product’s winning variation.',
  },
  {
    q: 'Can Suggest propose a discount?',
    a: 'Not from the AI suggested band. That band is an increase from the catalog price. Use Manual or Bulk adjust if you want to test a lower price.',
  },
  {
    q: 'How do offer tests show the sale price?',
    a: 'Assigned shoppers see the catalog price struck through, the offer price, and the message or offer amount under that cutout. Checkout applies the discount. Control stays at the catalog price with no offer.',
  },
  {
    q: 'Does a winner change every product in the experiment?',
    a: 'No. Each product has its own test. When sequential testing calls a result for one SKU, only that SKU ends. A winning variation updates that product’s Shopify price. If control wins, that catalog price stays. Sibling products keep collecting visitors until they have their own call.',
  },
];

export const DOCS_SECTION_IDS = DOCS_SECTIONS.map((section) => section.id);

export function getDocsSection(hash = '') {
  const id = String(hash || '')
    .trim()
    .replace(/^#/, '');
  if (!id) return null;
  return DOCS_SECTIONS.find((section) => section.id === id) || null;
}
