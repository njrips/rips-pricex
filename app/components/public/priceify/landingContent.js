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
  title: 'Turn your Shopify pricing into a growth test',
  lead:
    'Launch a price test in under 2 minutes. Priceify splits live shoppers across your price options, tracks revenue per visitor, conversion rate, and average order value, and uses a revenue guardrail to auto‑stop under‑performing products before they hurt your store.',
  primaryCta: 'Add to Shopify',
  secondaryCta: 'Start free trial',
};

export const LOGO_CLOUD = {
  /** Hidden until we have real merchant logos to show. */
  enabled: false,
  title: 'Trusted by Leading Brands',
};

export const PRICE_TEST_DEMO = {
  title: 'Two prices. Same traffic. One clear winner.',
  lead:
    'Priceify sends the same type of visitors to a control price and one or more test prices. For each variation, it measures revenue per visitor, conversion rate, and average order value — so a lower price that sells more units only wins if it truly grows revenue, not just orders.',
  winTitle: 'Variation B wins — +8.1% revenue per visitor',
  winMeta: '96% confidence after 9 days of live traffic',
  deployCta: 'Deploy Variation B',
};

export const PLATFORM_SECTION = {
  title: 'Your pricing tests in one place',
  lead:
    'Pick products, set price options, split traffic, and watch live performance. Priceify shows how each price point affects revenue per visitor, conversion rate, and average order value so you can move from guesswork to evidence‑based pricing.',
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
      body: 'Compare revenue per visitor, conversion rate, and average order value.',
    },
  ],
};

export const FEATURES_SECTION = {
  title: 'Everything a Shopify price test needs.',
  lead: 'Built around catalog prices, checkout, and the way Shopify stores actually run.',
  items: [
    {
      icon: 'ads_click',
      iconSrc: LANDING_ASSETS.featureAdsClick,
      title: 'Targeted audience insights',
      body: 'Target audiences by device, traffic source, or country — or let Priceify help you pick a sensible default for your first tests.',
    },
    {
      icon: 'alt_route',
      iconSrc: LANDING_ASSETS.featureAltRoute,
      title: 'Flexible test options',
      body: 'Run price tests and offer tests with multiple variations at once, all on your existing product pages — no duplicate URLs or landing pages required.',
    },
    {
      icon: 'auto_fix_normal',
      iconSrc: LANDING_ASSETS.featureAutoFix,
      title: 'AI‑suggested test prices',
      body: 'Set a min–max band and let Priceify suggest test prices inside it. Keep control over the range, while AI does the heavy lifting on picking price points to try.',
    },
    {
      icon: 'tune',
      iconSrc: LANDING_ASSETS.featureTune,
      title: 'Instant confidence metrics',
      body: 'Monitor lift, confidence, and test progress for your chosen success metric — revenue per visitor, conversion rate, or average order value.',
    },
    {
      icon: 'data_exploration',
      iconSrc: LANDING_ASSETS.featureData,
      title: 'Customisable product focus',
      body: 'Run a test on a single SKU, a collection, or your entire catalog. Start small, then roll winning prices across more products.',
    },
    {
      icon: 'assistant',
      iconSrc: LANDING_ASSETS.featureAssistant,
      title: 'RipX virtual assistant',
      body: 'Get help setting up tests, understanding results, and troubleshooting the revenue guardrail — directly inside the app, without leaving your Shopify admin.',
    },
  ],
};

export const PRICING_SECTION = {
  title: 'Priced so one winning test covers the year.',
  lead:
    'Plans are banded by test orders per month — you only pay for orders that went through a live test. Upgrade or cancel from your Shopify admin at any time.',
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
      blurb: 'For your first price or offer test on one product line.',
      cta: 'Start free trial',
      featured: false,
      features: [
        '1 test running at a time',
        'Price and offer tests',
        'Revenue guardrail, auto‑stop included',
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
      blurb: 'Where most growing Shopify stores land.',
      cta: 'Start free trial',
      featured: true,
      badge: 'MOST POPULAR',
      features: [
        'Unlimited concurrent tests',
        'Price and offer tests with multiple variations',
        'AI‑suggested price ranges',
        'Audience targeting by country and traffic source',
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
      blurb: 'Multi‑store setups and higher volumes.',
      cta: 'Start free trial',
      featured: false,
      features: [
        'Everything in Pro',
        'Multiple stores on one account',
        'Revenue guardrail threshold per test',
        'API and webhook access',
        'Onboarding call and test roadmap',
        'Dedicated customer success manager',
      ],
    },
  ],
};

export const FAQ_SECTION = {
  title: 'Frequently asked questions',
  subtitle: 'Questions Shopify merchants ask first.',
};

export const FAQ_ITEMS = [
  {
    q: 'Will this slow down my store?',
    a: "Priceify uses Theme connection and Checkout pricing functions, so it doesn't add heavy scripts or custom code to your store. A price test simply changes what price a visitor sees; it doesn't change how your pages are loaded. The revenue guardrail watches how each price affects revenue per visitor and can stop an under‑performing product, but it doesn't interfere with your store's speed.",
  },
  {
    q: 'Will customers see different prices at the same time?',
    a: 'Yes — that’s how a price test works. Each shopper is assigned to one variation for the duration of the test, so they see a consistent price while they browse and checkout. Different visitors may see different prices, but no individual shopper sees prices switching around.',
  },
  {
    q: 'Do I need a developer to set this up?',
    a: 'No. Install Priceify from the Shopify App Store, complete Store setup to connect your theme and checkout, map price locations if your theme needs it, and create your first test from the admin — all without touching theme code.',
  },
  {
    q: 'How long does a test need to run?',
    a: 'It depends on your traffic and how close your price options perform. Priceify shows confidence, revenue per visitor, and other metrics as data comes in. Once each variation reaches your minimum visitors and confidence level, you can decide when results are strong enough to apply a winning price.',
  },
  {
    q: 'What happens if a price test hurts conversion or refunds?',
    a: 'Priceify tracks conversion rate, revenue per visitor, and average order value for every price variation. After every variation reaches the test’s minimum visitors (at least 5,000) and 10 conversions, the revenue guardrail stops testing that product if any variation’s revenue per visitor drops more than the percentage you set compared with control. You can still watch other effects, like refunds or support tickets, in your usual Shopify and analytics dashboards before you roll a winning price out wider.',
  },
  {
    q: 'Does this work with my existing checkout / apps?',
    a: "Priceify runs on your Shopify catalog prices and checkout. It's built for standard Shopify stores and common app setups. If you use heavy checkout customisation or third‑party pricing apps, contact us and we'll confirm how Priceify will interact with your stack before you launch a test.",
  },
];

export const GET_STARTED_SECTION = {
  title: 'Get started easily',
  lead:
    'Explore the platform, learn how price testing works, or launch your first Shopify test with a guided template.',
  cards: [
    {
      title: 'Try the Priceify demo',
      body: 'See how Priceify sets prices, splits traffic, and reports results — before you launch a live test.',
      to: '/docs',
    },
    {
      title: 'Discover resources',
      body: 'Step‑by‑step guides on choosing products, setting bands, and reading price test results.',
      to: '/docs',
    },
    {
      title: 'Priceify revenue guardrail',
      body: 'Learn how the revenue guardrail monitors revenue per visitor and stops an under‑performing product while the rest of the test keeps running.',
      to: '/docs/settings',
    },
  ],
};

export const FINAL_CTA = {
  titleLine1: 'Your current price is a guess.',
  titleLine2: 'Fix that this week.',
  lead:
    'Install Priceify, pick one product, and have a real price test running before the end of the day — with a revenue guardrail watching every price while it runs.',
  primaryCta: 'Add to Shopify',
  secondaryCta: 'Start free trial',
  fine: '14‑day free trial · No credit card · No theme code · Uninstall in one click',
};

export const LANDING_SECTION_ORDER = [
  'hero',
  ...(LOGO_CLOUD.enabled ? ['logo-cloud'] : []),
  'price-test-demo',
  'platform',
  'features',
  'pricing',
  'faq',
  'get-started',
  'final-cta',
];

export const FOOTER_BRAND_TAGLINE = 'Test your way to prices that grow revenue.';

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

export const PUBLIC_COPY_FORBIDDEN =
  /Watch a 90|no theme changes|no code or theme changes|\bDocs\b|\bBlog\b/;

/** Merchant-facing public copy uses "test", not "experiment"; "Price locations", not "Price surfaces". */
export const PUBLIC_NAMING_FORBIDDEN =
  /\bexperiments?\b|\barms?\b|\bcampaigns?\b|\bprice surfaces?\b|\btheme app embed\b|\bPricing experimentation\b|\bSmart Pricing\b/i;

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
