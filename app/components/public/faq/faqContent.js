export const FAQ_ITEMS = [
  {
    id: 'install',
    question: 'How do I install RipsPriceX?',
    answer:
      'Use Install on Shopify. That opens the App Store listing. Shopify already knows your shop — you never type a .myshopify.com domain on this website.',
  },
  {
    id: 'shop-form',
    question: 'Why isn’t there a shop-domain box?',
    answer:
      'App Store apps must start install on Shopify surfaces. A shop field here would be the wrong path. After install, open Apps → RipsPriceX in Admin.',
  },
  {
    id: 'setup',
    question: 'What is Setup?',
    answer:
      'Setup is the in-app checklist: enable the RipsPriceX theme embed, confirm cart transform (Plus / development stores), and map price selectors so Launch can go green.',
  },
  {
    id: 'surfaces',
    question: 'What are price surfaces?',
    answer:
      'Shop-level CSS selectors for where test prices paint (PDP, listings, cart). Auto-map reads allowlisted theme files and verifies them on the live storefront. AI only ranks verified selectors.',
  },
  {
    id: 'billing',
    question: 'How does billing work?',
    answer:
      'Shopify App Pricing. Unpaid shops can open the Experiments list; Create and Launch stay locked. Upgrade from Settings → Plan. After approval, Shopify can send you to /app/welcome.',
  },
  {
    id: 'winner',
    question: 'How do I keep a winning price?',
    answer:
      'From the experiment, apply the winner. That writes the catalog price with write_products after you confirm. Until then the catalog price is unchanged.',
  },
  {
    id: 'plus',
    question: 'Do I need Shopify Plus?',
    answer:
      'Theme paint works on mapped storefront selectors. Checkout money following the test price uses cart transform, which Shopify exposes on Plus and development stores. Setup tells you which pieces are ready.',
  },
];
