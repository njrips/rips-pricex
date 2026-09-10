export const DOCS_UPDATED = 'September 9, 2026';

export const DOCS_HERO = {
  eyebrow: 'GUIDES',
  title: 'How Priceify tests stay safe and statistically valid.',
  subtitle:
    'Settings holds two choices — confidence level and minimum sample size. Everything else runs on a fixed limit, and each guide below says what that limit is and where you meet it. Info icons in Admin open the matching section here.',
};

export const DOCS_NAV_CARDS = [
  {
    href: '#price-safety',
    label: 'Guide 01',
    title: 'Price safety',
    body: 'The fixed caps on how far a test price may move, and the cost floor under every suggestion.',
  },
  {
    href: '#statistics',
    label: 'Guide 02',
    title: 'Confidence and sample size',
    body: 'The two settings you do choose, and how sequential evidence calls a winner.',
  },
  {
    href: '#enforced',
    label: 'Guide 03',
    title: 'What stops a test',
    body: 'The revenue-per-visitor pause, and the traffic-split fault that blocks a rollout.',
  },
  {
    href: '#ai-pricing',
    label: 'Guide 04',
    title: 'AI price suggestions',
    body: 'How Suggest fills a test price inside your band, then clamps it to the fixed limits.',
  },
  {
    href: '#price-surfaces',
    label: 'Guide 05',
    title: 'Price surfaces',
    body: 'Where a test price is painted on your storefront, and how to map a page.',
  },
  {
    href: '#offer-tests',
    label: 'Guide 06',
    title: 'Offer tests',
    body: 'Testing a discount instead of a new list price, applied at checkout.',
  },
];

export const DOCS_GROUPS = [
  {
    id: 'price-safety',
    eyebrow: 'PRICE SAFETY',
    title: 'The fixed limits every test price is built against.',
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
    title: 'The two settings you choose, and how a winner is called.',
    tone: 'plain',
  },
  {
    id: 'enforced',
    eyebrow: 'ENFORCEMENT',
    title: 'What pauses a test, and what blocks a rollout.',
    tone: 'deep',
  },
  {
    id: 'offer-tests',
    eyebrow: 'OFFER TESTS',
    title: 'How offer prices show on the product page and at checkout.',
    tone: 'plain',
  },
  {
    id: 'price-surfaces',
    eyebrow: 'PRICE SURFACES',
    title: 'Where a test price is painted on your storefront.',
    tone: 'plain',
  },
];

export const DOCS_SECTIONS = [
  {
    id: 'how-settings-work',
    group: 'price-safety',
    title: 'What you set, and what is fixed',
    summary:
      'Settings holds two choices: confidence level and minimum sample size per variation. Everything else that shapes a test is either fixed at a value you cannot edit, or set on the experiment itself rather than shop-wide. This section is the map of which is which.',
    facts: [
      { label: 'Shop-wide and editable', value: 'Confidence level, minimum sample size' },
      { label: 'Set per experiment', value: 'Revenue guardrail, traffic, audience, goals' },
      { label: 'Fixed, not editable', value: 'The price and planning limits below' },
      { label: 'Stamped at launch', value: 'All of them' },
    ],
    paragraphs: [
      'Two settings are yours to choose, both under Settings → Stat settings, and both apply to every experiment you launch: the confidence level a result must reach before a winner is called, and the minimum sample size each variation must reach before anything is calculated at all.',
      'A third group is set on the experiment rather than the shop, because the right answer differs from test to test. The revenue-per-visitor guardrail, the share of traffic the experiment takes, who is eligible for it, and which metric it optimises are all chosen on the Create steps and editable on the experiment afterwards.',
      'Everything else runs on a fixed value. Max price change caps how far a test price may move, a cost floor keeps suggestions above margin, and the planner works from a 10% target lift and 80% power. None of these are fields any more, and each guide below says what the value is. The one you can still move is max price change: the Products step offers to raise it in one click when the band you typed needs more room. Two smaller defaults work the same way and are mentioned where they matter — first-round candidate prices are seeded on the "recommended" spread, and a finished round may queue one follow-up draft, up to three rounds per product.',
      'All of it is stamped onto the experiment at launch. A running test keeps the values it started with, so changing a setting later never rewrites the statistics of a test already collecting data — and never moves the bar underneath one. The exception is a follow-up round, which is a new test you review and launch, so it picks up whatever is current at that point.',
    ],
  },
  {
    id: 'max-price-change',
    group: 'price-safety',
    title: 'Max price change',
    summary:
      'The widest a test price may move from the current catalog price, fixed at 15%. It is a hard cap on the band you type and on every price AI Suggest fills. The Products step is where you meet it, and where you can raise it in one click, up to 30%.',
    facts: [
      { label: 'Value', value: '15%, unless your store raised it' },
      { label: 'Ceiling', value: '30%' },
      { label: 'Where you meet it', value: 'Create → Products step' },
      { label: 'Applies to', value: 'The typed band and every suggested price' },
    ],
    paragraphs: [
      'This is the widest any test price may sit from the product’s current catalog price. It is a hard cap rather than a guideline: the min–max band on the Products step cannot be set past it, and every price AI Suggest fills is clamped to it per product before you see it.',
      'It is no longer a field in Settings, and the Products step is the only place you encounter it. When the band you type reaches past the cap, that step says so, quotes what it will use instead, and offers a button to raise the cap far enough to cover what you asked for — up to the 30% ceiling. Raising it there is permanent for the store, so a later experiment starts from the new figure, and your original band is put back in the field.',
      'The cap is not the only thing that can hold a price down. A cost floor applies underneath it, so a thin-margin product can be capped below your band even when the band is well inside 15%. The Products step reports how many prices that affected rather than quietly showing a smaller increase.',
      'A store that changed this value before it stopped being a field keeps the figure it chose. That is why the number quoted on your Products step may not be 15%.',
    ],
  },
  {
    id: 'cost-floor',
    group: 'price-safety',
    title: 'Cost floor: min margin and assumed COGS',
    summary:
      'A second limit under max price change, so a suggested price never lands near cost. Margin must stay above 35%, measured from the product’s unit cost in Shopify — or, when there is no unit cost, from an assumed cost of 55% of price. Neither figure is a field, and neither pauses a live test.',
    facts: [
      { label: 'Min margin', value: '35%' },
      { label: 'Assumed cost', value: '55% of price, when unit cost is unknown' },
      { label: 'Runs at', value: 'Plan build and AI Suggest' },
      { label: 'Live pause rule', value: 'No — only the revenue guardrail pauses a test' },
    ],
    paragraphs: [
      'Max price change caps how far a price may move; this caps how close it may come to cost. Both run when a plan is built and when AI Suggest clamps a price, and the tighter of the two wins. Because price tests here are increases, the floor rarely binds — but it is what stops a suggestion from collapsing toward cost on a product whose margin is already thin.',
      'Margin is calculated from the product’s unit cost in Shopify when that is set. When it is not, Priceify assumes cost is a fixed share of price — 55% — which is a working assumption rather than a measurement. Setting real unit costs in Shopify replaces the assumption for that product and makes the floor mean what it says.',
      'Neither figure is a field you edit, and neither is a live pause rule. They shape the prices a test starts with; the only thing that stops a running test on commercial grounds is the revenue-per-visitor guardrail.',
      'This is also why results are reported as revenue per visitor rather than profit per visitor. With one shop-wide cost percentage standing in for real per-variant cost, profit per visitor would be revenue per visitor scaled by a constant — it would rank every variation identically while reading like a second, independent measurement. Revenue per visitor is measured rather than assumed, so that is what the numbers you act on are built from.',
    ],
  },
  {
    id: 'ai-price',
    group: 'ai-pricing',
    title: 'AI price suggestions',
    summary:
      'On the Products step, Suggest fills a higher test price for every product and variation inside a min–max band you set. Control stays at the catalog price, increases only, and every suggestion is still capped by your price safety settings.',
    facts: [
      { label: 'Where', value: 'Create → Products step' },
      { label: 'Direction', value: 'Increases only, never discounts' },
      { label: 'Band', value: 'Percent or dollar amount' },
      { label: 'Hard cap', value: 'Shop max price change' },
      { label: 'Editable', value: 'Any cell, before launch' },
    ],
    paragraphs: [
      'On the Products step, choose AI suggested, set a min–max band as a percent or a dollar amount, then click Suggest. Control stays at the catalog price. Every selected product × test variation gets a suggested price. You can still edit any cell before launch.',
      'Suggest fills higher test prices only — the band is an increase from the catalog price, not a discount. A dollar band is the same cash increase on every product: $4–$8 adds $4–$8 whether the product sells for $20 or $200. Each product is still capped on its own by your price safety settings, so a flat dollar uplift never pushes a cheap product past your max price change.',
      'When AI is available, it proposes an increase inside your min–max for each product × variation. Higher-opportunity or stronger-margin products get larger lifts; thin-margin products get quieter ones. The model sees current price, 30-day units, opportunity score, and your shop max price-change and min-margin settings — the next guide lists every field exactly. It answers by row position rather than by product id, so it cannot name a product you did not select or invent a variation that does not exist.',
      'Each lift becomes a price: catalog × (1 + lift%), rounded to cents (whole yen for JPY). Shop max price change is a hard cap, and the band cannot be set past it: with the cap at 16%, typing 30% holds the field at 16% instead of accepting a number that could never be used. The Products step then says what you entered and offers to raise the cap to cover it in one click, up to 30%. Raising the cap puts your original number back in the band. A dollar band is capped the same way, converted at the average price of the products you selected. A second floor uses catalog margin from unit cost when known, otherwise Default COGS, so the suggestion does not collapse toward cost.',
      'Variations are spread across the full band instead of bunched near its middle. With a 10–20% band, three variations test 10%, 15%, and 20%. Prices that sit only a point or two apart cannot be told apart at realistic store traffic, so spanning the band is what makes the result readable. A single test variation sits mid-band.',
      'If a product\u2019s margin floor forces a price under your band minimum, Priceify says how many prices that affected instead of quietly showing a smaller increase. If AI is unavailable or skips a product × variation pair, the same even spread fills the gap, and if the request fails entirely the wizard applies that spread locally inside the same shop cap so the table is not left empty. Whenever a price on the table came from that spread rather than from the model, the banner says so and says how many — a filled-in table never claims to be AI work that it is not.',
    ],
  },
  {
    id: 'ai-price-inputs',
    group: 'ai-pricing',
    title: 'What the AI sees, and what it is told',
    summary:
      'Suggest sends one request per click: a few numbers about each product you selected, your two price safety limits, and a short list of rules. No customer data, no order records, no shop name, and nothing is stored or reused.',
    facts: [
      { label: 'Provider', value: 'OpenAI, JSON-only reply' },
      { label: 'Per request', value: 'Up to 40 selected products' },
      { label: 'Sent about a customer', value: 'Nothing' },
      { label: 'Time limit', value: '20 seconds, then the even spread' },
      { label: 'Stored by Priceify', value: 'Nothing — every click is fresh' },
    ],
    paragraphs: [
      'One click on Suggest is one request. For each product you selected, it carries the product title, its current price, its margin percent, how many units it sold in the last 30 days, its opportunity score, and Priceify’s own read on how hard that product can be pushed, worked out from its margin and demand before the request is built. Alongside that go the names of your test variations, the min–max band you typed, the metric the test is optimising, and two numbers from Settings: your max price change percent and your minimum margin percent. That is the whole payload.',
      'Nothing about a shopper is included: no customer names, emails, addresses, order records, session or visitor data. Your shop domain is not sent either, and neither are Shopify product or variant ids — products are numbered by their position in the request, and the reply refers to them by that number. Priceify does not keep the request or the reply: there is no cache on price suggestions, so clicking Suggest twice asks twice and a suggestion is never reused for another shop.',
      'The instructions are short and specific. The model is told to return strict JSON and nothing else; to give one uplift per test variation for every product, in the order the variations were sent; to keep every uplift a positive increase inside your min–max band and never above your max price change; to spread a product’s variations across the full band rather than cluster them, because prices a point or two apart cannot be told apart at real store traffic; and to prefer larger lifts where opportunity score or margin is strong and quieter ones where margin is thin. It is asked for a one-sentence summary, which is the line you read back on the Products step.',
      'The reply is checked before it reaches you rather than trusted. A number that is not a product in the request is discarded. An uplift outside your band is pulled back to the nearest edge. Every price is then rebuilt from your own catalogue price and re-clamped against your max price change and your margin floor, so a suggestion cannot exceed your limits even if the model ignored them. Only after that does it become a price in the table — and you can still edit any cell before launch.',
      'The request is given 20 seconds and one retry. Past that, or if the reply is unusable, the even band spread answers instead and the banner says so. Selecting more than 40 products is allowed; the first 40 go to the model, the rest take the even spread, and the count that did is included in the same notice. AI settings themselves are operational rather than merchant-facing: which model is used, and whether a key is configured at all, is set on the server, and with no key configured Suggest still works — it just always uses the even spread.',
    ],
  },
  {
    id: 'confidence',
    group: 'statistics',
    title: 'Confidence level',
    summary:
      'How sure the maths has to be before a variation is called the winner. 90% accepts about a 1-in-10 chance of a false winner and is the recommended default; 95% is stricter but needs more traffic and more orders to reach.',
    facts: [
      { label: 'Where', value: 'Settings → Stat settings' },
      { label: 'Options', value: '90% (default) or 95%' },
      { label: 'Applies to', value: 'Experiments launched from then on' },
      { label: 'Acts as', value: 'The second gate, after the sample floors' },
    ],
    paragraphs: [
      'The two settings act in sequence rather than independently. The minimum sample size decides when a result may be calculated at all; the confidence level decides when the calculated result is strong enough to call a winner. Neither one alone will produce a decision.',
      'Confidence is a false-winner budget. At 90% you accept roughly a 1-in-10 chance that a variation is called the winner when it was really no better than the control; at 95% that becomes about 1-in-20. The protection is not free: for the same real lift, 95% needs meaningfully more traffic and more orders, so tests take longer and fewer of them reach a decision. For price testing, 90% is usually the better trade, because a wrong call is reversible — you can revert the price — while a test that never finishes teaches you nothing.',
      'Internally the setting is stored as confidence (0.90), and the maths uses its complement as the significance level, alpha (0.10). At 95% the alpha is 0.05. When an experiment has more than one challenger, that alpha is divided across the challenger-versus-control comparisons, so a three-variation test demands stronger evidence per comparison than a two-variation test. Running several variations therefore costs traffic; it does not quietly raise your false-winner risk.',
      'The percentage shown on a running experiment is not this setting. It is the current strength of evidence, calculated as one minus the p-value of the sequential test, and it moves as orders arrive. So an experiment set to 90% may read 62% one day and 91% the next. The setting is the line that reading has to cross. Until the sample floors are met, no reading is shown at all: the experiment reports what it is still waiting for instead of a percentage, because a confidence figure drawn from a handful of orders is not merely imprecise, it is wrong.',
      'Because the evidence is sequential rather than fixed-horizon, you may look at a running experiment as often as you like without weakening the guarantee. A conventional t-test or z-test assumes you look once, at a sample size fixed in advance, and loses its false-positive protection if you stop the moment the number looks good. That is the trap sequential testing is built to avoid, and it is why there is no penalty for checking daily.',
      'Reaching your confidence level is what calls a winner, but it is not on its own what lets Priceify write a price to your catalog unattended. Automatic writes additionally require a conversion-rate goal, confirmation from the exact conversion test rather than the directional one, and 14 days of outcome maturity so refunds and cancellations have landed. Revenue-per-visitor goals always wait for your review.',
      'Two things confidence does not mean. It is not the probability that the variation is better — it is the probability of seeing evidence this strong if the variation were in truth no different. And it says nothing about how much better: a 95% result on a +1% lift is a reliable finding about a difference too small to matter commercially. Read the confidence figure to decide whether the difference is real, and the lift to decide whether it is worth having.',
      'A running experiment keeps the confidence level it launched with. Changing this setting applies to experiments you create from then on, which is what keeps a test that is already collecting from being judged against a bar that moved underneath it.',
    ],
  },
  {
    id: 'min-sample',
    group: 'statistics',
    // Named after the field in Settings. Titled "Minimum sample and planning
    // reference", it could not be found by searching the setting's own name.
    title: 'Minimum sample size per variation',
    summary:
      'The earliest point a result may be read. Until every variation reaches this many visitors, nothing is calculated — no confidence figure, no winner, no automatic price write. A second floor of 100 conversions per variation applies too, and both must be met.',
    facts: [
      { label: 'Where', value: 'Settings → Stat settings' },
      { label: 'Default', value: '5,000 visitors per variation' },
      { label: 'Range', value: '1 to 1,000,000' },
      { label: 'Measured on', value: 'The variation with the fewest visitors' },
      { label: 'Second floor', value: '100 conversions per variation' },
      { label: 'Planning inputs', value: '10% target lift, 80% power — both fixed' },
    ],
    paragraphs: [
      'Set it once and it applies to every experiment — Create no longer asks for it. The floor is per variation, and it is measured against the variation with the fewest visitors, not against the total across the experiment. A two-variation test at 5,000 needs 5,000 in each arm, so 10,000 visitors overall — and if a 50/50 split has drifted, or one arm is a smaller audience, the slower arm holds the whole test. That is deliberate. A comparison is only as strong as its weaker side, so calling a result off a well-populated control and a thin challenger would be reading noise.',
      'While an experiment is below the floor it tells you which floor is binding and how far the slowest variation has got — for example, waiting for 5,000 visitors per variation, lowest variation has 3,180. The Confidence figure reads as a dash rather than a number during this period. Seeing a percentage there would invite a decision the evidence cannot yet support, which is the single most common way a price test is called wrong.',
      'Visitors are not the only floor, because visitors are not the unit the decision is made in. A price test compares conversion rates and revenue per visitor, and both are driven by order counts. So a second floor requires 100 conversions in every variation, and both floors must be met. 5,000 visitors sounds substantial, but at a 0.4% conversion rate it is 20 orders, and at 20 orders a +40% lift can appear and then evaporate as the test continues — regression toward the mean, not a price effect. Priceify never calls a result on fewer than 10 conversions per variation whatever else is configured.',
      'Setting the minimum very low does not buy you faster answers. The conversion floor still applies, and the sequential evidence still has to reach your confidence level, so a low visitor floor mostly just moves the point at which the waiting message switches from counting visitors to counting orders. Setting it very high has the opposite risk: an experiment can be configured so that it will not plausibly finish, which is why Review quotes a feasible collection window and flags the cases it cannot support.',
      'The floor is not the same thing as the planning reference, and the two answer different questions. The floor is the earliest a result may be read. The planning reference is the sample the statistics actually expect to need, calculated per product from its own conversion rate, the 10% target lift, your confidence level, 80% power, and the number of challenger comparisons. A product whose planning reference is far above your floor will usually keep collecting well past it; a product with strong traffic may clear both quickly.',
      'Target lift and power are the two planning inputs you do not choose. Target lift is fixed at 10% — the smallest relative conversion improvement the planner sizes for, and the width it also uses to calibrate sequential evidence. Power is fixed at 80%, the chance of detecting a lift that size when it is real. Neither is a promise about your result: a test can find a much larger lift, or none. They set how much traffic the plan expects to need, which is why Review’s timeline moves when a product’s own conversion rate does but not when your confidence level is the only thing you changed.',
      'Review shows a whole-week collection range only when current traffic can support a practical 2–8 week test. Longer calculations are labeled not feasible and replaced with the eligible visitors/day needed to reach the selected minimum by 8 weeks. When orders accumulate more slowly than visitors, the window is quoted from the conversion floor and says so.',
      'For a new store without enough measured product traffic, shop-level traffic is only a low-confidence planning prior. Broadening the audience or raising experiment allocation on the Audience step will shorten collection, but neither lowers your minimum sample or invents a shorter statistically valid timeline.',
      'A running experiment keeps the floor it launched with, so raising or lowering this setting never changes what an in-flight test is waiting for. A follow-up round queued after a winner is applied is the exception, and it applies to both settings: because it is a new test you review and launch rather than a continuation, it takes the minimum sample and confidence level in force at that point. What it does carry over from the previous round is what that round measured about the product — its conversion rate and baseline — since those are observations rather than preferences.',
    ],
  },
  {
    id: 'min-conversions',
    group: 'statistics',
    title: 'Minimum conversions per variation',
    summary:
      'The second floor a result has to clear: 100 conversions in every variation, however many visitors it has seen. There is no field for it, because a confidence figure read below it would be wrong rather than merely early.',
    facts: [
      { label: 'Value', value: '100 conversions per variation' },
      { label: 'Absolute minimum', value: '10, whatever else is configured' },
      { label: 'Editable', value: 'No field — it is a validity floor' },
      { label: 'Measured on', value: 'The variation with the fewest orders' },
    ],
    paragraphs: [
      'No winner is called until every variation has reached this many conversions, however many visitors it has seen. It sits alongside minimum sample: a result needs both the visitors and the conversions.',
      'Visitors are the wrong unit for the decision. A price test compares conversion rates and revenue per visitor, and both are driven by order counts. 5,000 visitors per variation sounds substantial, but at a 0.4% conversion rate that is 20 orders — and at 20 orders a +40% lift can appear and then vanish as the test continues. That is regression toward the mean, not a price effect.',
      'The floor is also what makes the statistics valid rather than merely tidy. The confidence figure comes from a normal approximation whose variance estimate needs a minimum number of conversions per arm; below roughly 10 the number is not conservative, it is wrong. Priceify therefore refuses to read a result under 10 conversions per variation under any circumstances, and sits its own floor at 100.',
      'This is not a substitute for planning. The required sample still comes from the product’s conversion rate, the target lift, your confidence level, and power — a flat conversion count cannot replace that calculation. The floor exists to stop an early sequential call from being made on a handful of orders.',
      'It sits at 100, which is what 5,000 visitors produces at the 2% baseline the planner assumes, so it and the default minimum sample describe the same test. Review folds this floor into its timeline: when conversions take longer to accumulate than visitors, the collection window is quoted from the conversion floor and says so. There is no field for it in Stat settings, because it is a validity floor rather than a preference — a result read below it would be wrong rather than merely early. It is stamped onto each test at launch alongside the minimum sample size.',
    ],
  },
  {
    id: 'goals',
    group: 'statistics',
    title: 'Primary and secondary metrics',
    summary:
      'The Audience step picks the one metric the test is judged on. Revenue per visitor is the default and answers the commercial question; conversion rate is the only metric an automatic price write will act on. Secondary metrics are recorded for context and never decide anything.',
    facts: [
      { label: 'Where', value: 'Create → Audience step' },
      { label: 'Primary choices', value: 'Revenue per visitor, conversion rate, or a custom goal' },
      { label: 'Default', value: 'Revenue per visitor' },
      { label: 'Secondary metrics', value: 'Any number — recorded, never decisive' },
    ],
    paragraphs: [
      'One metric decides the test. Revenue per visitor is the default and usually the right one for a price test: raising a price often trades a little conversion for more revenue per shopper, and revenue per visitor is the number that tells you whether that trade paid. Conversion rate answers a narrower question — how many shoppers bought — and ignores what they paid, so a price rise can look like a straight loss on it.',
      'The choice also decides how far the statistics can go on their own. Conversion rate is the only metric with an exact sequential boundary behind it, so it is the only one an automatic price write will ever act on. Revenue per visitor is measured against an estimate of order-value spread, which is enough to inform your judgement and not enough to authorise an unattended price change — a revenue-per-visitor winner always waits for you to apply it.',
      'Secondary metrics are recorded alongside the primary one and never decide anything. They are there to catch the thing the primary metric cannot see: a price rise that holds revenue per visitor but halves add-to-cart is worth knowing about before you roll it out. A metric already used as the primary cannot also be a secondary.',
      'A custom goal replaces the primary metric with an event of your own — fired manually, or by a URL match, a click on a selector, or a form being started or submitted. It is judged the same way a conversion is, so it needs the same conversion floor before anything is read.',
      'Profit per visitor is no longer offered. Cost of goods was taken as one shop-wide percentage rather than per-variant cost, which made the metric revenue per visitor scaled by a constant: it ranked every variation identically while reading like a separate measurement. An experiment launched on it keeps it, and keeps reporting under that name, so its history still reads correctly.',
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
    summary:
      'Results are read with a sequential boundary, so you may check a running test as often as you like without inflating false positives. Two layers do the work: a directional one covering every metric, and an exact one for conversion rate.',
    facts: [
      { label: 'Directional layer', value: 'Mixture-SPRT, all metrics' },
      { label: 'Confirming layer', value: 'Exact, conversion rate only' },
      { label: 'Peeking', value: 'Safe — no penalty for checking early' },
      { label: 'Scope', value: 'Each product decides on its own' },
    ],
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
    summary:
      'Off unless your store turns it on. When on, a winning price is written to your catalog only after every condition holds — including a conversion-rate goal, exact confirmation, 14 days of running, and a three-day review window you can interrupt.',
    facts: [
      { label: 'Default', value: 'Off, and there is no switch to turn it on' },
      { label: 'Metric', value: 'Conversion rate only' },
      { label: 'Minimum duration', value: '14 days' },
      { label: 'Review window', value: '3 days after you are emailed' },
      { label: 'Never applies', value: 'Revenue-per-visitor results' },
    ],
    paragraphs: [
      'Auto-apply writes a winning price to the Shopify catalog without asking. Because that is expensive to undo, every one of these has to hold: the metric is conversion rate, both sample floors are met, the exact boundary agrees with the directional one on the same winner, the traffic split matches the test’s allocation, no guardrail has been breached, and the test has run at least 14 days.',
      'The 14 days are about time rather than volume. A week carries its own shape — weekday and weekend shoppers do not behave alike — so a result measured over a single week can be a calendar artefact at any sample size. Two full cycles also give recent orders room to be cancelled or refunded before a price is committed.',
      'Revenue-per-visitor results never auto-apply. Their spread depends on order values, which vary far more than a yes-or-no conversion, and Priceify measures that spread with a proxy. A proxy is enough to inform your judgement and not enough to authorise an unattended price change.',
      'Each product decides on its own. One SKU reaching a verdict writes only that SKU’s price; its siblings keep running until their own evidence arrives. A control win ends that product with the catalog price untouched.',
      'Once all of that holds, a review window still runs before anything is written — three days, counted from the moment the product reached a decision and you were emailed about it. Applying a product yourself at any point during the window cancels the automatic write for it.',
      'Automatic writes are off, and Priceify deliberately offers no way to switch them on: a price written to your catalog without a person looking at it is not a default worth making one click away. A store that wants them runs with them enabled at the account level. If yours is one, the Performance tab says so and names the date of the next write, and that same banner carries the switch to turn them off — which leaves every finished product waiting for you to apply it, and takes nothing already written back.',
    ],
  },
  {
    id: 'rollout-queue',
    group: 'statistics',
    title: 'Rollout queue and ready-to-apply alerts',
    summary:
      'An experiment covering ten products is ten independent tests that finish at different times. The Performance tab opens with one row per product, ordered by what needs you, so you can apply a finished product without ending the rest of the experiment.',
    facts: [
      { label: 'Where', value: 'Experiment → Performance tab' },
      { label: 'Granularity', value: 'One row per product' },
      { label: 'Actions', value: 'Apply a row, or apply all ready' },
      { label: 'Never offered', value: 'Products the revenue guardrail stopped' },
      { label: 'Alerts', value: 'Emailed once per product' },
    ],
    paragraphs: [
      'An experiment covering ten products is ten independent tests. They almost never finish together: a high-traffic SKU can have a confirmed winner in a fortnight while a slower one is still weeks from its sample floor, and a third may be better off on its control price. Ending the whole experiment to act on the first is a false choice, and waiting for the slowest one costs you the lift you have already measured.',
      'The Performance tab therefore opens with a rollout queue: one row per product, ordered by what needs you rather than alphabetically. Products you can act on come first, then anything blocked by a traffic-split fault, then everything still collecting — with the ones nearest their floors ahead of the ones that just started. Each row names the price move, why the product is in that state, and how far along it is; opening a row shows the per-variation numbers and the evidence behind the call.',
      'Apply on a row writes that one product’s price and stops that one test. Apply all ready does the same for every finished product in one action, skipping anything still collecting or blocked, and reports separately on any that failed. A control win or a winning offer has no catalog price to write, so those rows finish the product instead. Either way the rest of the experiment keeps running.',
      'A product the revenue guardrail stopped is never offered for rollout. The guardrail fires because a variation lost money against control, so applying that price would act on the exact reading the guardrail rejected. Those rows say what the drop was and against which limit, and they stay on their original price — nothing was written to your catalog.',
      'You are emailed the first time each product reaches a decision, at your store’s Shopify contact address. Products that cross over together are batched into one message, and each product is only ever mentioned once, so a slow-finishing experiment does not turn into a mailing list. If a message cannot be sent the products stay queued for the next attempt rather than being silently dropped.',
    ],
  },
  {
    id: 'guardrail-metrics',
    group: 'enforced',
    title: 'Revenue guardrail: the max revenue drop that pauses a test',
    summary:
      'The one rule that stops a live test on commercial grounds. Once each variation has about 100 visitors, Priceify compares revenue per visitor against control, and pauses the test if a challenger is down by more than the percent you set. Each experiment sets its own figure on the Audience step, starting at 10%.',
    facts: [
      { label: 'Where', value: 'Create → Audience step, per experiment' },
      { label: 'Default', value: '10%' },
      { label: 'Range', value: '3% to 50%' },
      { label: 'Starts checking at', value: '~100 visitors per variation' },
      { label: 'Effect', value: 'Pauses the test and stops assignment' },
    ],
    paragraphs: [
      'A price test can lose money while it runs. This is the rule that limits how much. Once each variation has around 100 visitors — enough for the comparison to mean anything at all — Priceify compares each challenger’s revenue per visitor to control’s, and if a challenger is down by more than your threshold, it pauses the test and stops assigning shoppers to it. Nothing was written to your catalog, so the pause costs you the test rather than a price.',
      'The threshold belongs to the experiment, not the shop. You set it on the Audience step anywhere from 3% to 50%, and it starts at 10%. There is no shop-wide ceiling above it: a test that wants to tolerate a 40% drop while it learns can, and a running test keeps the figure it launched with. Tightening it makes a test more likely to stop early on ordinary variance; loosening it buys the test room at the cost of revenue you can measure.',
      'This is a safety pause, not a verdict. It reads the observed point estimate rather than a significance boundary, which is exactly what you want from a circuit breaker and exactly what you should not treat as evidence that the price is worse. A paused test can be resumed once you have looked at it.',
      'A product the guardrail stopped is never offered for rollout. The guardrail fired because that variation lost money against control, so applying its price would be acting on the reading the guardrail rejected. Those rows say what the drop was and against which limit, and the product stays on its original price.',
      'It is the only operational guardrail on the Audience step. The limits on how far a price may move, and the cost floor beneath it, are separate checks that run when prices are built rather than while the test runs.',
    ],
  },
  {
    id: 'srm',
    group: 'enforced',
    title: 'Traffic split checks',
    summary:
      'Priceify continuously checks that visitors actually reached the variations in the proportions you set. A sample ratio mismatch is a data fault rather than a close result, so it blocks winner rollout instead of merely warning you.',
    facts: [
      { label: 'Test', value: 'Chi-square against your allocation' },
      { label: 'Threshold', value: 'p < 0.001' },
      { label: 'Effect', value: 'Blocks rollout and automatic writes' },
      { label: 'Common causes', value: 'Bots, page caching, early assignment' },
    ],
    paragraphs: [
      'Every result assumes visitors reached the variations in the proportions you set. Priceify checks that assumption continuously with a chi-square test against your allocation and flags a sample ratio mismatch when the observed split is more skewed than chance can explain, at the industry-standard threshold of p < 0.001.',
      'A mismatch is a data fault, not a close result. Common causes are bot traffic landing on one variation, a page cache serving one price more often, or assignment firing before the visitor is counted. Whatever the cause, the two groups are no longer comparable, so the lift between them is not measuring price.',
      'This is why a mismatch blocks rather than warns. Winner rollout is refused and no price is written automatically until the split is healthy. It also invalidates the exact conversion boundary specifically, because that boundary’s null is your designed split — if the real split is not the designed one, the test is answering the wrong question.',
    ],
  },
  {
    id: 'follow-up-rounds',
    group: 'statistics',
    title: 'Follow-up rounds',
    summary:
      'When a product finishes a round, Priceify may queue a second test for it — as a draft you review and launch, never as a live test. Up to three rounds per product, so a product cannot iterate on its own price indefinitely.',
    facts: [
      { label: 'Queued as', value: 'A draft, on your experiments list' },
      { label: 'Launches itself', value: 'Never' },
      { label: 'Cap', value: 'Three rounds per product' },
      { label: 'Uses', value: 'The settings current when you launch it' },
    ],
    paragraphs: [
      'A finished round tells you something about the product’s price sensitivity, and the useful next question is usually narrower than the first one: if +10% won, is +15% better still? Priceify therefore queues a follow-up test for a product that finished a round, seeded from what that round measured.',
      'It arrives as a draft, and nothing about it is automatic beyond the drafting. It appears on your experiments list for you to open, adjust the prices in, and launch — or delete. No price reaches your catalog because a round rolled over, and no traffic is assigned to a follow-up you have not launched.',
      'Because a follow-up is a new test rather than a continuation, it takes the confidence level and minimum sample size in force when you launch it, not the ones its parent ran with. What it does inherit is what the parent measured about the product — its conversion rate and baseline — since those are observations rather than preferences.',
      'Each product may go three rounds. The cap is there because iterating on a price forever is a way of eventually finding a winner by chance rather than by effect, and because a product whose third round is still inconclusive is telling you its price is not the lever.',
    ],
  },
  {
    id: 'price-surfaces',
    group: 'price-surfaces',
    title: 'Price surfaces',
    summary:
      'A table of rows, each saying where one price appears: a surface, which price it is, and the CSS selector that finds it. A running test repaints exactly these and nothing else. Auto-map fills the table from your theme; Pick lets you click the price on your live storefront instead.',
    facts: [
      { label: 'Where', value: 'Settings \u2192 Price surfaces' },
      { label: 'Applies to', value: 'Every price test on the shop' },
      { label: 'Limit', value: '25 rows' },
      { label: 'Required', value: 'Product page, regular price' },
    ],
    paragraphs: [
      'Each row has three parts. Surface is where on the store the price appears \u2014 product page, collection page, cart, search results, home page, recommendations, quick view, any page, or one specific URL. Role is which price on that surface: the regular price, the struck-through compare-at price, a unit price, and so on. Selector is the CSS selector that finds that price in your theme\u2019s markup. Save applies the table to every price test on the shop; a test already running picks it up on the next page view.',
      'Only the product page regular price is genuinely required. Every other surface is optional, and leaving one unmapped means Priceify does not touch prices there \u2014 it does not guess. That is the safe default, but it does mean a shopper can see the test price on the product page and the catalog price on a collection card, so map the surfaces where your prices are visible together.',
      'Start with Auto-map. It reads your theme\u2019s own price templates, verifies each candidate selector against your live pages, and proposes one per surface for you to review before anything is saved. It never invents a selector: a candidate that cannot be found on a real page is reported as unmatched rather than saved hopefully. Use Pick for anything Auto-map cannot reach \u2014 a custom section, an app block, a bundle widget \u2014 which opens the page in a preview and turns the price you click into a selector.',
      'Specific URL is for a page that is not a page type. Surfaces are otherwise recognised from the path, so /products/ is a product page and /collections/ a collection page, but a hand-built landing page has no such signature: every /pages/ URL looks alike. Choosing Specific URL replaces the Role column with a page URL box, and that row then applies on that page only. Paste the URL from your address bar; the query string is ignored, so a link carrying campaign parameters still matches, and so does the same page in another language.',
      'A Specific URL row is deliberately narrow. It cannot stand in for the product page \u2014 the readiness check still reports the product page as unmapped until a product page row exists \u2014 and it is pinned to the regular price, because a page is not a kind of price. Two rows may share a selector as long as they name different pages, which is what lets one theme class serve several landing pages.',
      'A row is only as good as its selector. Priceify writes the price text into the node the selector finds, so a selector that matches a whole price block rather than the amount inside it can flatten the surrounding markup; the painter resolves down to the amount where it can. It also refuses to paint a compare-at node from a regular-price row, so a struck-through price is never quietly rewritten as the live one. If a row\u2019s selector may not target a price at all, the table says so under the table rather than waiting for you to find out on the storefront.',
      'Themes change. A theme update, or switching theme entirely, can rename the classes these selectors depend on, and a stale selector paints nothing rather than painting something wrong. Re-run Auto-map after a theme change and check Setup\u2019s readiness, which reports a missing product page selector as a blocking gap.',
    ],
  },
  {
    id: 'offers',
    group: 'offer-tests',
    title: 'Offer tests',
    summary:
      'Test a discount instead of a new list price. Control stays at the catalog price with no discount, assigned shoppers see a sale cutout on the product page, and checkout applies the discount through the Priceify checkout function.',
    facts: [
      { label: 'Where', value: 'Create → Products step' },
      { label: 'One offer', value: 'Per test variation' },
      { label: 'Control', value: 'Catalog price, no discount' },
      { label: 'Requires', value: 'The checkout discount function on Setup' },
    ],
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
    a: 'No. Every value a test is judged against is stamped on it at launch. Change confidence or minimum sample size in Settings and the next experiment you launch picks them up; the revenue guardrail lives on the experiment itself, so edit it there.',
  },
  {
    q: 'Where did the guardrail settings go?',
    a: 'Settings now holds two choices: confidence level and minimum sample size per variation. Max price change, min margin, assumed COGS, target lift, and power still apply, but at fixed values you no longer set — each guide above says what the value is. The revenue guardrail moved onto the experiment, on the Audience step, because the right figure differs from test to test.',
  },
  {
    q: 'Why is profit per visitor no longer a metric?',
    a: 'Because it was not measuring profit. Cost of goods was one shop-wide percentage rather than real per-variant cost, so profit per visitor was revenue per visitor scaled by a constant and ranked every variation identically. Revenue per visitor is measured rather than assumed. An experiment already running on profit per visitor keeps it.',
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

/**
 * Guide sections matching a search term, for Help.
 *
 * Help used to search only its own 11 troubleshooting answers, so a merchant
 * typing "confidence" or "sample size" found nothing — the sections written to
 * answer exactly that were reachable only by knowing which info icon to click
 * in Settings. Titles are matched first so the section named after the term
 * outranks one that merely mentions it.
 */
export function searchDocsSections(query = '') {
  // Matched word by word rather than as one string, so "sample size per
  // variation" and "per-variation sample size" both find the section. Every
  // word has to appear somewhere, which keeps a long phrase from returning
  // every section that happens to contain "price".
  const words = String(query || '')
    .toLowerCase()
    .split(/[^a-z0-9%]+/)
    .filter(Boolean);
  if (!words.length) return [];
  const scored = [];
  for (const section of DOCS_SECTIONS) {
    const title = String(section.title || '').toLowerCase();
    const body = [section.summary || '', ...(section.paragraphs || [])]
      .concat((section.facts || []).map((fact) => `${fact.label} ${fact.value}`))
      .join(' ')
      .toLowerCase();
    const haystack = `${title} ${body}`;
    if (!words.every((word) => haystack.includes(word))) continue;
    // The section named after the term outranks one that merely mentions it.
    scored.push({ section, rank: words.every((word) => title.includes(word)) ? 0 : 1 });
  }
  return scored.sort((a, b) => a.rank - b.rank).map((entry) => entry.section);
}
