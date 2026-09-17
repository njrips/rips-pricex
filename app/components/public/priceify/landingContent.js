/** Static paths for Figma-exported landing art (see public/priceify/landing/). */
export const LANDING_ASSETS = {
  heroDashboard: '/priceify/landing/hero-dashboard.png',
  priceTestDemo: '/priceify/landing/price-test-demo.png',
  platformWalkthrough: '/priceify/landing/platform-walkthrough.png',
  logoMarquee: '/priceify/landing/logo-marquee.png',
  flare: '/priceify/landing/flare.svg',
  shopifyBag: '/priceify/landing/shopify-bag.svg',
  chevronDown: '/priceify/landing/chevron-down.svg',
  chevronRight: '/priceify/landing/chevron-right.svg',
  arrowForward: '/priceify/landing/arrow-forward.svg',
  finalCtaDots: '/priceify/landing/final-cta-dots.png',
  featureAdsClick: '/priceify/landing/feature-ads-click.svg',
  featureAltRoute: '/priceify/landing/feature-alt-route.svg',
  featureAutoFix: '/priceify/landing/feature-auto-fix.svg',
  featureTune: '/priceify/landing/feature-tune.svg',
  featureData: '/priceify/landing/feature-data-exploration.svg',
  featureAssistant: '/priceify/landing/feature-assistant.svg',
  chevronRightDark: '/priceify/landing/chevron-right-dark.svg',
};

export const HERO = {
  badge: 'A/B PRICE TESTING FOR SHOPIFY',
  title: 'Turn Your Shopify Pricing Into a Growth Test',
  lead:
    'Launch a price test in under 2 minutes. Guardrails auto-stop anything that hurts your store, page speed, refunds, bounce rate — before it matters.',
  primaryCta: 'Add to Shopify',
  secondaryCta: 'Start Free Trial',
};

export const LOGO_CLOUD = {
  title: 'Trusted by Leading Brands',
};

export const PRICE_TEST_DEMO = {
  title: 'Two prices. Same traffic. One clear winner.',
  lead:
    'Priceify splits your live shoppers between a control and a variation, then measures revenue per visitor — not just orders — so a cheaper price that sells more units cannot fool you.',
  winTitle: 'Variation B wins — +8.1% revenue per visitor',
  winMeta: '96% confidence after 9 days of live traffic',
  deployCta: 'Deploy Variation B',
};

export const PLATFORM_SECTION = {
  title: 'Your entire pricing strategy in one place',
  lead: 'Run tests, track performance, and find the price that drives the most revenue.',
  steps: [
    {
      title: 'Choose products',
      body: 'Select the products you want to include in your test.',
    },
    {
      title: 'Split traffic',
      body: 'Control how many shoppers see each price variation.',
    },
    {
      title: 'Create price variations',
      body: 'Set your current price and create one or more alternative prices.',
    },
    {
      title: 'Measure the results',
      body: 'Compare conversion, revenue, profit, and other important metrics.',
    },
  ],
};

export const FEATURES_SECTION = {
  title: 'Everything a price test needs.',
  lead: 'Built around price, checkout and the way Shopify stores actually run.',
  items: [
    {
      icon: 'ads_click',
      iconSrc: LANDING_ASSETS.featureAdsClick,
      title: 'Targeted Audience Insights',
      body: 'Target audiences by device, source, or location — or let AI assist.',
    },
    {
      icon: 'alt_route',
      iconSrc: LANDING_ASSETS.featureAltRoute,
      title: 'Diverse Test Options',
      body: 'Conduct A/B, multivariate, split URL, and offer tests.',
    },
    {
      icon: 'auto_fix_normal',
      iconSrc: LANDING_ASSETS.featureAutoFix,
      title: 'AI-Driven Pricing Suggestions',
      body: 'AI can suggest ideal test prices based on your margins.',
    },
    {
      icon: 'tune',
      iconSrc: LANDING_ASSETS.featureTune,
      title: 'Instant Confidence Metrics',
      body: 'Monitor lift %, confidence %, and test progress.',
    },
    {
      icon: 'data_exploration',
      iconSrc: LANDING_ASSETS.featureData,
      title: 'Customizable Product Focus',
      body: 'Test a single SKU, a collection, or your entire catalog.',
    },
    {
      icon: 'assistant',
      iconSrc: LANDING_ASSETS.featureAssistant,
      title: 'RipX Virtual Assistant',
      body: 'Receive assistance and troubleshoot tests within the app.',
    },
  ],
};

export const PRICING_SECTION = {
  title: 'Priced so one winning test covers the year.',
  lead:
    'Banded by test orders per month — you only pay for traffic that actually went through a test. Change or cancel from your Shopify admin.',
  saveBadge: 'Save 20%',
  seeAllPlansLabel: 'See All Plans',
  tiers: [
    {
      id: 'starter',
      name: 'Starter',
      annualPrice: '$79',
      monthlyPrice: '$99',
      annualPeriod: '/ month ~ billed annually',
      monthlyPeriod: '/ month',
      price: '$79',
      period: '/ month ~ billed annually',
      orders: 'Up to 1,000 test orders / month',
      blurb: 'For a first test on one product line.',
      cta: 'Start free trial',
      featured: false,
      features: [
        '1 test running at a time',
        'Price and shipping-threshold tests',
        'All 6 guardrails, auto-stop included',
        'Real-time confidence tracking',
        'Email support',
      ],
    },
    {
      id: 'pro',
      name: 'Pro',
      annualPrice: '$199',
      monthlyPrice: '$249',
      annualPeriod: '/ month ~ billed annually',
      monthlyPeriod: '/ month',
      price: '$199',
      period: '/ month ~ billed annually',
      orders: 'Up to 5,000 test orders / month',
      ordersHighlight: true,
      blurb: 'Where most Shopify stores land.',
      cta: 'Start free trial',
      featured: true,
      badge: 'MOST POPULAR',
      features: [
        'Unlimited concurrent tests',
        'Every test type, including A/B/n',
        'AI-suggested price ranges',
        'Audience targeting by country and source',
        'Slack and email guardrail alerts',
        'Priority support with a named contact',
      ],
    },
    {
      id: 'advanced',
      name: 'Advanced',
      annualPrice: '$449',
      monthlyPrice: '$562',
      annualPeriod: '/ month ~ billed annually',
      monthlyPeriod: '/ month',
      price: '$449',
      period: '/ month ~ billed annually',
      orders: 'Up to 20,000 test orders / month',
      blurb: 'Multi-store and higher volume.',
      cta: 'Start free trial',
      featured: false,
      features: [
        'Everything in Growth',
        'Multiple stores on one account',
        'Custom guardrail metrics and thresholds',
        'API and webhook access',
        'Onboarding call and test roadmap',
        'Dedicated customer success manager',
      ],
    },
  ],
};

export const FAQ_SECTION = {
  title: 'Frequently Asked Questions',
  subtitle: 'Questions merchants ask first.',
};

export const FAQ_ITEMS = [
  {
    q: 'Will this slow down my store?',
    a: 'Page load time is one of the six guardrail metrics Priceify watches on every test. If a variation pushes load time past the threshold you set, Priceify alerts you or stops the test automatically — so a slow variation cannot quietly stay live.',
  },
  {
    q: 'Will customers see different prices at the same time?',
    a: 'Yes — that is how a price test works. Each shopper is assigned to one variation for the test, so they see a consistent price while they browse and checkout.',
  },
  {
    q: 'Do I need a developer to set this up?',
    a: 'No. Install from the Shopify App Store, complete Theme connection on Store setup, map price locations if your theme needs it, and create your first test from the admin — no theme code edits required.',
  },
  {
    q: 'How long does a test need to run?',
    a: 'It depends on traffic and how close the variations perform. Priceify shows confidence and lift as data comes in so you can decide when results are strong enough to act on.',
  },
  {
    q: 'What happens if a price test hurts conversion or refunds?',
    a: 'Guardrails watch conversion, refunds, bounce rate, page speed, and more. If a variation crosses a limit you set, Priceify can alert you or stop the test automatically.',
  },
  {
    q: 'Does this work with my existing checkout / apps?',
    a: 'Priceify runs on your Shopify catalog prices and checkout. It is built for standard Shopify stores; if you use heavy checkout customization, contact us and we will confirm fit.',
  },
];

export const GET_STARTED_SECTION = {
  title: 'Get started easily',
  lead:
    'Explore the platform, dive into insightful articles, or begin your project management journey with a tailored template.',
  cards: [
    {
      title: 'Try the Priceify demo',
      body: "Experience Priceify's powerful features firsthand",
      to: '/docs',
    },
    {
      title: 'Discover Resources',
      body: 'Comprehensive guides and learning resources',
      to: '/docs',
    },
    {
      title: 'Priceify Guardrails',
      body: 'Track six essential metrics for every test',
      to: '/docs/settings',
    },
  ],
};

export const FINAL_CTA = {
  titleLine1: 'Your current price is a guess.',
  titleLine2: 'Fix that this week.',
  lead:
    'Install Priceify, pick one product, and have a real price test running before the end of the day — with six guardrails watching it the whole time.',
  primaryCta: 'Add to Shopify',
  secondaryCta: 'Start Free Trial',
  fine: '14-day free trial · No credit card · No theme code · Uninstall in one click',
};

export const LANDING_SECTION_ORDER = [
  'hero',
  'logo-cloud',
  'price-test-demo',
  'platform',
  'features',
  'pricing',
  'faq',
  'get-started',
  'final-cta',
];

export const FOOTER_BRAND_TAGLINE = 'Test Your Way to Better Pricing.';

/** @deprecated use FOOTER_BRAND_TAGLINE */
export const FOOTER_BLURB = FOOTER_BRAND_TAGLINE;

/** @deprecated brochure footer uses FOOTER_COPYRIGHT */
export const FOOTER_TAGLINE = FOOTER_BRAND_TAGLINE;

export const FOOTER_COPYRIGHT = 'Copyright © Priceify. All rights reserved.';

export const FOOTER_NEWSLETTER = {
  title: 'Join our newsletter',
  placeholder: 'Enter your email',
  button: 'Subscribe',
  consentPrefix: 'By subscribing you agree to our',
  privacyLabel: 'Privacy Policy',
};

export const FOOTER_SOCIAL = {
  title: 'Follow Us',
  items: [
    {
      label: 'LinkedIn',
      href: 'https://www.linkedin.com/company/priceify',
      icon: '/priceify/landing/social-linkedin.svg',
      external: true,
    },
    {
      label: 'Facebook',
      href: 'https://www.facebook.com/',
      icon: '/priceify/landing/social-facebook.svg',
      external: true,
    },
    {
      label: 'Instagram',
      href: 'https://www.instagram.com/',
      icon: '/priceify/landing/social-instagram.svg',
      external: true,
    },
    {
      label: 'YouTube',
      href: 'https://www.youtube.com/',
      icon: '/priceify/landing/social-youtube.svg',
      external: true,
    },
  ],
};

export const FOOTER_LINK_SECTIONS = [
  {
    heading: 'Product',
    links: [
      { label: 'Pricing', hash: 'pricing' },
      { label: 'Features', hash: 'features' },
      { label: 'Book a Demo', to: '/contact' },
    ],
  },
  {
    heading: 'Integrations',
    links: [
      { label: 'For Shopify', install: true },
      { label: 'For Adobe Commerce', muted: true },
      { label: 'For WooCommerce', muted: true },
      { label: 'For Bigcommerce', muted: true },
    ],
  },
  {
    heading: 'Resources',
    links: [
      { label: 'FAQ', hash: 'faq' },
      { label: 'Blog', to: '/docs' },
    ],
  },
  {
    heading: 'Company',
    links: [
      { label: 'About Us', to: '/contact' },
      { label: 'Contact Us', to: '/contact' },
      { label: 'Privacy Policy', to: '/privacy' },
      { label: 'Terms and Conditions', to: '/terms' },
      { label: 'Cookies Policy', to: '/privacy' },
    ],
  },
];

/** Legacy three-column layout for older references. */
export const FOOTER_COLUMNS = FOOTER_LINK_SECTIONS.slice(0, 3).map(section => ({
  heading: section.heading,
  links: section.links.filter(link => !link.muted && !link.install),
}));

/** Legacy exports kept for docs/tests that still reference older section ids. */
export const HOW_IT_WORKS_STEPS = PLATFORM_SECTION.steps;
export const FEATURE_CARDS = FEATURES_SECTION.items.map(item => ({
  icon: item.icon,
  title: item.title,
  body: item.body,
}));
export const PROBLEM_CARDS = [];
export const WALKTHROUGH_STEPS = PLATFORM_SECTION.steps.map((step, index) => ({
  title: step.title,
  body: step.body,
  mock: ['hypothesis', 'variations', 'results', 'results'][index] || 'results',
}));
export const WALKTHROUGH_EYEBROW = 'How it works';
export const USE_CASES = [];
/** @deprecated use PRICE_TEST_DEMO.lead */
export const EXPERIMENT_INTRO = PRICE_TEST_DEMO.lead;
export const EXPERIMENT_POINTS = [];
export const RESULTS_POINTS = [];
export const HERO_SETUP_MOCK = { nav: [] };
/** @deprecated layout mock only */
export const EXPERIMENT_MOCK = { heading: '', charts: [], control: {}, variation: {} };
export const RESULTS_BOARD = { columns: [], control: {}, variation: {} };
export const WALKTHROUGH_MOCKS = {};

export const PUBLIC_COPY_FORBIDDEN =
  /Watch a 90|no theme changes|no code or theme changes|\bDocs\b|\bBlog\b/;

/** Merchant-facing public copy uses "test", not "experiment"; "Price locations", not "Price surfaces". */
export const PUBLIC_NAMING_FORBIDDEN =
  /\bexperiments\b|\bExperiment\b|\bexperiment\b|Price surfaces|\bprice surfaces\b|\btheme app embed\b|\bPricing experimentation\b|\bSmart Pricing\b/i;

export function buildFaqJsonLd(items = FAQ_ITEMS) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map(item => ({
      '@type': 'Question',
      name: item.q,
      acceptedAnswer: {
        '@type': 'Answer',
        text: item.a,
      },
    })),
  };
}
