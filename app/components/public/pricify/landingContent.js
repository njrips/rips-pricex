export const PROBLEM_CARDS = [
  {
    title: 'Test before you change',
    body: 'Experiment with a portion of your traffic instead of changing prices for everyone at once.',
  },
  {
    title: 'Learn from real shoppers',
    body: 'See how customers actually respond to different price points — not what you assume they will.',
  },
  {
    title: 'Make better pricing decisions',
    body: 'Use measurable results instead of relying only on intuition or industry benchmarks.',
  },
];

export const HOW_IT_WORKS_STEPS = [
  {
    title: 'Choose your products',
    body: 'Select the products you want to include in your experiment.',
  },
  {
    title: 'Create price variations',
    body: 'Set your current price and create one or more alternative prices to test.',
  },
  {
    title: 'Split your traffic',
    body: 'Control how many shoppers see each price variation during the experiment.',
  },
  {
    title: 'Measure the results',
    body: 'Compare conversion, revenue, profit, and other important metrics.',
  },
];

export const WALKTHROUGH_EYEBROW = 'Build your experiment';

export const WALKTHROUGH_STEPS = [
  {
    title: 'Start with a clear pricing hypothesis.',
    body: 'Define what you want to test and create an experiment without complicated setup. Name your experiment, choose a timeframe, and you’re ready to add products.',
    mock: 'hypothesis',
  },
  {
    title: 'Choose what to test and who sees it.',
    body: 'Select products, set test prices, and control how much traffic enters your experiment. You decide exactly which products are included and what prices to compare.',
    mock: 'variations',
  },
  {
    title: 'Know which price performs better.',
    body: 'Compare variations and track metrics such as conversion rate, revenue per visitor, and experiment performance. Get a clear picture of how each price point behaved.',
    mock: 'results',
  },
];

export const FEATURE_CARDS = [
  {
    icon: 'icon-chart',
    title: 'Data-driven decisions',
    body: 'Use real customer behavior to evaluate pricing changes rather than relying on assumptions about what shoppers will accept.',
  },
  {
    icon: 'icon-split',
    title: 'Controlled experimentation',
    body: 'Test new prices with selected traffic before making a broader change. Keep your existing price running for the rest of your visitors.',
  },
  {
    icon: 'icon-gauge',
    title: 'Meaningful metrics',
    body: 'Understand how pricing affects conversion, revenue per visitor, and other important outcomes — not just surface-level click data.',
  },
  {
    icon: 'icon-tag',
    title: 'Free to use',
    body: 'Run pricing experiments without paying for another experimentation platform. Pricify is available free on the Shopify App Store.',
  },
];

export const EXPERIMENT_INTRO =
  'With controlled traffic, compare your test against a control, and monitor important metrics while your experiment runs.';

export const EXPERIMENT_POINTS = [
  {
    title: 'Control vs. variation',
    body: 'Show your original price alongside a test price to see which performs better with real customers.',
  },
  {
    title: 'Traffic allocation',
    body: 'Choose how much of your traffic enters the experiment and in what proportion.',
  },
  {
    title: 'Performance comparison',
    body: 'See how each price point is performing in real time.',
  },
  {
    title: 'Guardrail metrics',
    body: 'Monitor key metrics so you can see how the experiment affects your store.',
  },
];

export const RESULTS_POINTS = [
  'Conversion rate per variation',
  'Revenue per visitor',
  'Total conversions and revenue',
  'Performance lift compared to control',
];

export const HERO_SETUP_MOCK = {
  url: 'app.pricify.io/experiments',
  crumb: 'Experiments',
  title: 'Summer Hoodie Price Test',
  status: 'Running',
  meta: 'Started Aug 12 · 1,020 visitors · 7 days left',
  nav: ['Experiments', 'Analytics', 'Settings'],
  progress: '62%',
  control: {
    label: 'Control',
    share: '50%',
    price: '$59.00',
    stats: [
      { label: 'Conv. rate', value: '3.2%' },
      { label: 'Rev/visitor', value: '$1.89' },
      { label: 'Visitors', value: '510' },
    ],
  },
  variation: {
    label: 'Variation A',
    share: '50%',
    price: '$69.00',
    stats: [
      { label: 'Conv. rate', value: '4.4%', lift: true },
      { label: 'Rev/visitor', value: '$3.04', lift: true },
      { label: 'Visitors', value: '510' },
    ],
  },
};

export const EXPERIMENT_MOCK = {
  heading: 'Traffic allocation',
  controlShare: '50% → Control',
  variationShare: '50% → Variation A',
  control: {
    label: 'Control',
    note: 'Current price',
    price: '$59.00',
    stats: [
      { label: 'Conv. rate', value: '3.2%' },
      { label: 'Rev/visitor', value: '$1.89' },
      { label: 'Visitors', value: '510' },
    ],
  },
  variation: {
    label: 'Variation A',
    note: 'Test price',
    price: '$69.00',
    stats: [
      { label: 'Conv. rate', value: '4.4%' },
      { label: 'Rev/visitor', value: '$3.04' },
      { label: 'Visitors', value: '510' },
    ],
  },
  progress: '62%',
  charts: [
    { label: 'Revenue per visitor', control: 48, variant: 78 },
    { label: 'Conversion rate', control: 42, variant: 64 },
  ],
};

export const RESULTS_BOARD = {
  winner: 'Var A Experiment winner',
  columns: ['Conv. Rate', 'Rev/Visit', 'Lift'],
  control: { name: 'Control', conv: '3.2%', rev: '$1.89', lift: '—' },
  variation: { name: 'Variation A', conv: '4.4%', rev: '$3.04', lift: '+61%' },
  insight: 'The $69.00 price point generated higher revenue per visitor than the $59.00 control.',
};

export const WALKTHROUGH_MOCKS = {
  hypothesis: {
    url: 'app.pricify.io/experiments/new',
    title: 'New Experiment',
    name: 'Summer Collection Price Test',
    hypothesis:
      'A higher price may increase revenue per visitor without significantly reducing conversion rate.',
    duration: '14 days',
    next: 'Next: Add Products',
  },
  variations: {
    url: 'app.pricify.io/experiments/setup/products',
    title: 'Products & Prices',
    product: 'Wool Blend Hoodie',
    sku: 'WBH-001',
    control: '$59.00',
    variation: '$69.00',
  },
  results: {
    url: 'app.pricify.io/experiments/summer-test/results',
    title: 'Results',
    conversion: { control: '3.2%', variation: '4.4%' },
    revenue: { control: '$1.89', variation: '$3.04' },
  },
};

export const LANDING_SECTION_ORDER = [
  'hero',
  'problem',
  'how-it-works',
  'walkthrough',
  'benefits',
  'experiment-safely',
  'results',
  'use-cases',
  'faq',
  'cta',
];

export const USE_CASES = [
  {
    label: 'Use case 01',
    title: 'Test a price increase',
    body: 'Find out whether customers respond differently to a higher price before making it permanent for your entire store.',
  },
  {
    label: 'Use case 02',
    title: 'Find a stronger price point',
    body: 'Compare multiple prices to understand which performs better for your specific products and audience.',
  },
  {
    label: 'Use case 03',
    title: 'Validate a new product price',
    body: 'Test a price before it becomes the default for everyone — useful when launching a new product or variant.',
  },
  {
    label: 'Use case 04',
    title: 'Optimize high-value products',
    body: 'Experiment with products where even small pricing changes can have meaningful business impact.',
  },
];

export const FAQ_ITEMS = [
  {
    q: 'Is Pricify really free?',
    a: 'Yes. Pricify is free to install and free to use for running pricing experiments on your Shopify store — there’s no paid tier required to get started.',
  },
  {
    q: 'Do I need coding experience?',
    a: 'No. Install from the App Store and finish setup in Shopify Admin, including enabling the theme app embed. You do not write code.',
  },
  {
    q: 'Can I choose which products to test?',
    a: 'Yes. When you create an experiment, you choose the products that enter the test.',
  },
  {
    q: 'Can I control how much traffic sees each price?',
    a: 'Yes. You set how traffic is split between your current price and each test price.',
  },
  {
    q: 'What metrics can I measure?',
    a: 'You can compare conversion, revenue per visitor, total conversions and revenue, and lift versus the control price.',
  },
  {
    q: 'Can I stop an experiment?',
    a: 'Yes. Pause or stop a test from the app at any time. When you are ready, you can apply a winning price to the catalog.',
  },
  {
    q: 'Does Pricify work with my Shopify store?',
    a: 'Yes. Pricify is a Shopify-native app and uses your existing checkout.',
  },
];

export const FOOTER_BLURB =
  'Pricing experimentation for Shopify merchants. Test before you change.';

export const FOOTER_TAGLINE = 'Built for Shopify merchants.';

export const FOOTER_COLUMNS = [
  {
    heading: 'Product',
    links: [
      { label: 'How it works', hash: 'how-it-works' },
      { label: 'Features', hash: 'features' },
      { label: 'FAQ', hash: 'faq' },
    ],
  },
  {
    heading: 'Legal',
    links: [
      { label: 'Privacy Policy', to: '/privacy' },
      { label: 'Terms of Service', to: '/terms' },
    ],
  },
  {
    heading: 'Support',
    links: [
      { label: 'Contact', to: '/contact' },
      { label: 'Staff login', to: '/staff/login' },
      { label: 'Install on Shopify', install: true },
    ],
  },
];

export const PUBLIC_COPY_FORBIDDEN =
  /\bguardrails\b|Watch a 90|no theme changes|no code or theme changes|\bDocs\b|\bBlog\b/;

export function buildFaqJsonLd(items = FAQ_ITEMS) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((item) => ({
      '@type': 'Question',
      name: item.q,
      acceptedAnswer: {
        '@type': 'Answer',
        text: item.a,
      },
    })),
  };
}
