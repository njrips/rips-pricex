export const DOCS_UPDATED = 'August 29, 2026';

export const DOCS_HERO = {
  eyebrow: 'GUIDES',
  title: 'How Priceify tests stay safe and statistically valid.',
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
      'Settings holds two stat settings: confidence level and minimum sample size per variation. Both apply to every experiment you launch. A running test keeps the values stamped at launch, so changing them later never rewrites the statistics of a test already collecting data.',
      'The price limits described below are no longer fields you edit. They run on the defaults quoted in each section, except on a store that changed one before this page was simplified, where the value that store chose is kept. Max price change is the exception you can still move: the Products step offers to raise it in one click when a suggested band needs more room. The revenue guardrail is set per experiment on the Audience step, and Create still lets you change traffic and audience for that experiment.',
    ],
  },
  {
    id: 'max-price-change',
    group: 'price-safety',
    title: 'Max price change',
    paragraphs: [
      'This is the widest a test price may move from the current catalog price. It defaults to 15% and may go as high as 30%. It is a hard cap for AI Suggest and for plan build — the min–max band on Products cannot be set past it, and the Products step offers to raise it in one click when you try. Raising it there is permanent for the store, so a later experiment starts from the new figure.',
    ],
  },
  {
    id: 'max-revenue-drop',
    group: 'price-safety',
    title: 'Max revenue drop',
    paragraphs: [
      'Always on for price and offer tests. After each variation has about 100 visitors, Priceify compares revenue per visitor to control. If any challenger drops more than this percent, the test pauses and assignment stops.',
      'Each experiment sets its own limit on the Audience step, anywhere from 3% to 50%, starting at 10%. The value is stamped at launch, so a running test pauses at the limit it started with.',
    ],
  },
  {
    id: 'min-margin',
    group: 'price-safety',
    title: 'Min margin',
    paragraphs: [
      'Suggested prices stay above a minimum margin, 35% by default, when unit cost is known. This check runs at plan time and when AI Suggest clamps a price — it is not a live pause rule, and it is not a field you set.',
    ],
  },
  {
    id: 'default-cogs',
    group: 'price-safety',
    title: 'Default COGS',
    paragraphs: [
      'When a product has no unit cost in Shopify, Priceify assumes cost is a fixed share of price, 55% by default. Margin checks and AI Suggest use that assumed cost; set unit costs in Shopify for a product and its real cost is used instead. Results are reported as revenue per visitor, which is measured rather than assumed. Profit per visitor is not shown alongside it: a running test applies one shop-wide cost percentage, which would make profit per visitor simply revenue per visitor scaled by a constant, ranking every variation identically.',
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
      'Each lift becomes a price: catalog × (1 + lift%), rounded to cents (whole yen for JPY). Shop max price change is a hard cap, and the band cannot be set past it: with the cap at 16%, typing 30% holds the field at 16% instead of accepting a number that could never be used. The Products step then says what you entered and offers to raise the cap to cover it in one click, up to 30%. Raising the cap puts your original number back in the band. A dollar band is capped the same way, converted at the average price of the products you selected. A second floor uses catalog margin from unit cost when known, otherwise Default COGS, so the suggestion does not collapse toward cost.',
      'Variations are spread across the full band instead of bunched near its middle. With a 10–20% band, three variations test 10%, 15%, and 20%. Prices that sit only a point or two apart cannot be told apart at realistic store traffic, so spanning the band is what makes the result readable. A single test variation sits mid-band.',
      'If a product\u2019s margin floor forces a price under your band minimum, Priceify says how many prices that affected instead of quietly showing a smaller increase. If AI is unavailable or skips a product × variation pair, the same deterministic spread fills the gap, and if the request fails entirely the wizard applies that spread locally inside the same shop cap so the table is not left empty.',
    ],
  },
  {
    id: 'confidence',
    group: 'statistics',
    title: 'Confidence level',
    paragraphs: [
      'Set under Settings → Stat settings, with two choices: 90%, the recommended default for pricing tests, and 95%, which is stricter. It is the second of the two gates a result has to pass. The minimum sample size decides when a result may be calculated at all; the confidence level decides when the calculated result is strong enough to call a winner.',
      'Confidence is how much of a false-winner risk you are willing to carry. At 90% you accept roughly a 1-in-10 chance that a variation is called the winner when it was really no better than the control. At 95% that becomes about 1-in-20. The protection is not free: for the same real lift, 95% needs meaningfully more traffic and more orders, so tests take longer and fewer of them reach a decision. For price testing, 90% is usually the better trade, because a wrong call is reversible — you can revert the price — while a test that never finishes teaches you nothing.',
      'Internally the setting is stored as confidence (0.90), and the maths uses its complement as the significance level, alpha (0.10). At 95% the alpha is 0.05. When an experiment has more than one challenger, that alpha is divided across the challenger-versus-control comparisons, so a three-variation test demands stronger evidence per comparison than a two-variation test. Running several variations therefore costs traffic; it does not quietly raise your false-winner risk.',
      'The percentage shown on a running experiment is not this setting. It is the current strength of evidence, calculated as one minus the p-value of the sequential test, and it moves as orders arrive. So an experiment set to 90% may read 62% one day and 91% the next. The setting is the line that reading has to cross. Until the sample floors are met, no reading is shown at all: the experiment reports what it is still waiting for instead of a percentage, because a confidence figure drawn from a handful of orders is not merely imprecise, it is wrong.',
      'Because the evidence is sequential rather than fixed-horizon, you may look at a running experiment as often as you like without weakening the guarantee. A conventional t-test or z-test assumes you look once, at a sample size fixed in advance, and loses its false-positive protection if you stop the moment the number looks good. That is the trap sequential testing is built to avoid, and it is why there is no penalty for checking daily.',
      'Reaching your confidence level is what calls a winner, but it is not on its own what lets Priceify write a price to your catalog unattended. Automatic writes additionally require a conversion-rate goal, confirmation from the exact conversion test rather than the directional one, and 14 days of outcome maturity so refunds and cancellations have landed. Revenue-per-visitor goals always wait for your review.',
      'Two things confidence does not mean. It is not the probability that the variation is better — it is the probability of seeing evidence this strong if the variation were in truth no different. And it says nothing about how much better: a 95% result on a +1% lift is a reliable finding about a difference too small to matter commercially. Read the confidence figure to decide whether the difference is real, and the lift to decide whether it is worth having.',
      'A running experiment keeps the confidence level it launched with. Changing this setting applies to experiments you create from then on, which is what keeps a test that is already collecting from being judged against a bar that moved underneath it.',
    ],
  },
  {
    id: 'target-lift',
    group: 'statistics',
    title: 'Target lift',
    paragraphs: [
      'Target lift is the smallest relative conversion improvement used by the fixed-horizon planning reference, fixed at 10%. It also calibrates sequential evidence.',
      'It is a planning target, not a promise that every test will find that lift.',
    ],
  },
  {
    id: 'min-sample',
    group: 'statistics',
    title: 'Minimum sample and planning reference',
    paragraphs: [
      'Minimum sample size per variation is the earliest point at which Priceify will evaluate a result. Until every variation has reached it, nothing is calculated: no confidence figure, no winner, and no automatic price write. Set it once under Settings → Stat settings and it applies to every experiment — Create no longer asks for it. The default is 5,000 visitors per variation, and the field accepts anything from 1 up to 1,000,000.',
      'The floor is per variation, and it is measured against the variation with the fewest visitors, not against the total across the experiment. A two-variation test at 5,000 needs 5,000 in each arm, so 10,000 visitors overall — and if a 50/50 split has drifted, or one arm is a smaller audience, the slower arm holds the whole test. That is deliberate. A comparison is only as strong as its weaker side, so calling a result off a well-populated control and a thin challenger would be reading noise.',
      'While an experiment is below the floor it tells you which floor is binding and how far the slowest variation has got — for example, waiting for 5,000 visitors per variation, lowest variation has 3,180. The Confidence figure reads as a dash rather than a number during this period. Seeing a percentage there would invite a decision the evidence cannot yet support, which is the single most common way a price test is called wrong.',
      'Visitors are not the only floor, because visitors are not the unit the decision is made in. A price test compares conversion rates and revenue per visitor, and both are driven by order counts. So a second floor requires 100 conversions in every variation, and both floors must be met. 5,000 visitors sounds substantial, but at a 0.4% conversion rate it is 20 orders, and at 20 orders a +40% lift can appear and then evaporate as the test continues — regression toward the mean, not a price effect. Priceify never calls a result on fewer than 10 conversions per variation whatever else is configured.',
      'Setting the minimum very low does not buy you faster answers. The conversion floor still applies, and the sequential evidence still has to reach your confidence level, so a low visitor floor mostly just moves the point at which the waiting message switches from counting visitors to counting orders. Setting it very high has the opposite risk: an experiment can be configured so that it will not plausibly finish, which is why Review quotes a feasible collection window and flags the cases it cannot support.',
      'The floor is not the same thing as the planning reference, and the two answer different questions. The floor is the earliest a result may be read. The planning reference is the sample the statistics actually expect to need, calculated per product from its own conversion rate, the 10% target lift, your confidence level, 80% power, and the number of challenger comparisons. A product whose planning reference is far above your floor will usually keep collecting well past it; a product with strong traffic may clear both quickly.',
      'Review shows a whole-week collection range only when current traffic can support a practical 2–8 week test. Longer calculations are labeled not feasible and replaced with the eligible visitors/day needed to reach the selected minimum by 8 weeks. When orders accumulate more slowly than visitors, the window is quoted from the conversion floor and says so.',
      'For a new store without enough measured product traffic, shop-level traffic is only a low-confidence planning prior. Broadening the audience or raising experiment allocation on the Audience step will shorten collection, but neither lowers your minimum sample or invents a shorter statistically valid timeline.',
      'A running experiment keeps the floor it launched with, so raising or lowering this setting never changes what an in-flight test is waiting for. A follow-up round queued after a winner is applied is the exception, and it applies to both settings: because it is a new test you review and launch rather than a continuation, it takes the minimum sample and confidence level in force at that point. What it does carry over from the previous round is what that round measured about the product — its conversion rate and baseline — since those are observations rather than preferences.',
    ],
  },
  {
    id: 'min-conversions',
    group: 'statistics',
    title: 'Minimum conversions per variation',
    paragraphs: [
      'No winner is called until every variation has reached this many conversions, however many visitors it has seen. It sits alongside minimum sample: a result needs both the visitors and the conversions.',
      'Visitors are the wrong unit for the decision. A price test compares conversion rates and revenue per visitor, and both are driven by order counts. 5,000 visitors per variation sounds substantial, but at a 0.4% conversion rate that is 20 orders — and at 20 orders a +40% lift can appear and then vanish as the test continues. That is regression toward the mean, not a price effect.',
      'The floor is also what makes the statistics valid rather than merely tidy. The confidence figure comes from a normal approximation whose variance estimate needs a minimum number of conversions per arm; below roughly 10 the number is not conservative, it is wrong. Priceify therefore enforces at least 10 per variation, and this floor is fixed at 100 rather than set by you.',
      'This is not a substitute for planning. The required sample still comes from your conversion rate, target lift, confidence, and power — a fixed conversion count cannot replace that calculation. The floor exists to stop an early sequential call from being made on a handful of orders.',
      'It sits at 100, which is what 5,000 visitors produces at the 2% baseline the planner assumes, so it and the default minimum sample describe the same test. Review folds this floor into its timeline: when conversions take longer to accumulate than visitors, the collection window is quoted from the conversion floor and says so. There is no field for it in Stat settings, because it is a validity floor rather than a preference — a result read below it would be wrong rather than merely early. It is stamped onto each test at launch alongside the minimum sample size.',
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
      'Classic tests can be read at any time. A fixed-horizon p-value cannot: checking it repeatedly and stopping at the first good-looking moment inflates false positives well past the stated confidence. Priceify therefore reads results with a sequential boundary, which is built to be looked at continuously without that penalty.',
      'Two layers do the work. The directional layer is a mixture-SPRT and covers every metric, including revenue per visitor. It estimates variance from running totals, and value metrics use an average-order-value proxy rather than order-level spread, so it is evidence to weigh rather than a decision to act on unattended.',
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
      'Revenue-per-visitor results never auto-apply. Their spread depends on order values, which vary far more than a yes-or-no conversion, and Priceify measures that spread with a proxy. A proxy is enough to inform your judgement and not enough to authorise an unattended price change.',
      'Each product decides on its own. One SKU reaching a verdict writes only that SKU’s price; its siblings keep running until their own evidence arrives. A control win ends that product with the catalog price untouched.',
      'Once all of that holds, a review window still runs before anything is written — three days, counted from the moment the product reached a decision and you were emailed about it. Applying a product yourself at any point during the window cancels the automatic write for it.',
      'Automatic writes are off unless your store turned them on. While they are on, the Performance tab says so and names the date of the next write, and the same banner carries the switch to turn them off. Doing so leaves every finished product waiting for you to apply it.',
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
      'You are emailed the first time each product reaches a decision, at your store’s Shopify contact address. Products that cross over together are batched into one message, and each product is only ever mentioned once, so a slow-finishing experiment does not turn into a mailing list. If a message cannot be sent the products stay queued for the next attempt rather than being silently dropped.',
    ],
  },
  {
    id: 'srm',
    group: 'statistics',
    title: 'Traffic split checks',
    paragraphs: [
      'Every result assumes visitors reached the variations in the proportions you set. Priceify checks that assumption continuously with a chi-square test against your allocation and flags a sample ratio mismatch when the observed split is more skewed than chance can explain, at the industry-standard threshold of p < 0.001.',
      'A mismatch is a data fault, not a close result. Common causes are bot traffic landing on one variation, a page cache serving one price more often, or assignment firing before the visitor is counted. Whatever the cause, the two groups are no longer comparable, so the lift between them is not measuring price.',
      'This is why a mismatch blocks rather than warns. Winner rollout is refused and no price is written automatically until the split is healthy. It also invalidates the exact conversion boundary specifically, because that boundary’s null is your designed split — if the real split is not the designed one, the test is answering the wrong question.',
    ],
  },
  {
    id: 'guardrail-metrics',
    group: 'enforced',
    title: 'Revenue guardrail',
    paragraphs: [
      'The Audience step keeps one operational guardrail: revenue per visitor. After each variation has about 100 visitors, Priceify compares the observed point estimate to control. If any challenger drops more than this percent, the test pauses and assignment stops. This reversible safety pause is heuristic, not statistical winner evidence.',
      'You set the threshold on the Audience step of the experiment it belongs to, anywhere from 3% to 50%. There is no shop-wide ceiling on it: each experiment carries its own figure, and a running test keeps the one it launched with. The price limits described above — max price change, min margin — are separate checks that run when prices are built, not extra Audience rows.',
    ],
  },
  {
    id: 'scenario-preset',
    group: 'enforced',
    title: 'Scenario preset and round 2',
    paragraphs: [
      'The scenario preset seeds first-round candidate prices when Priceify builds a plan (conservative, recommended, or aggressive), still inside the max price-change band. It runs on "recommended" and is not a field you set. The Products step AI Suggest banner uses your typed min–max band instead, then clamps to max price change and min margin.',
      'Auto-start round 2 decides whether a finished learning round may queue a follow-up test for that product. It is on, and capped at three rounds per product. A queued follow-up is a draft you review and launch, so nothing reaches your catalog because a round rolled over.',
    ],
  },
  {
    id: 'offers',
    group: 'offer-tests',
    title: 'Offer tests',
    paragraphs: [
      'On the Products step, set one offer per test variation. Control stays at the catalog price with no discount so you can measure the offer against the current price.',
      'Assigned shoppers see a sale cutout on the product page: catalog price struck through, the offer price beside it, and the offer message — or the offer amount if you left the message empty — under that cutout. Checkout applies the discount through the Priceify checkout function.',
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
    q: 'Will Priceify invent a 2% conversion rate?',
    a: 'No. A planning reference is calculated only from a qualified product conversion rate. If traffic is missing, Priceify does not show a timeline; if a new-store traffic prior is available, Review labels it low-confidence and never presents an impractical multi-year result as a forecast.',
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
