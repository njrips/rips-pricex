/**
 * This is intended to be a basic starting point for linting in your app.
 * It relies on recommended configs out of the box for simplicity, but you can
 * and should modify this configuration to best suit your team's needs.
 */

/** @type {import('eslint').Linter.Config} */
module.exports = {
  root: true,
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    ecmaFeatures: {
      jsx: true,
    },
  },
  env: {
    browser: true,
    commonjs: true,
    // es6 only declares the ES2015 globals, so later ones — `globalThis` above
    // all — read as undefined variables.
    es2022: true,
  },
  // The `dist/function.js` bundles are Shopify Functions build output, compiled
  // against a `ShopifyFunction` global that only exists in their runtime.
  ignorePatterns: ["!**/.server", "!**/.client", "extensions/*/dist/**"],

  // Base config
  extends: ["eslint:recommended"],

  rules: {
    // This codebase marks a deliberately unused binding by prefixing it with an
    // underscore — kept positional arguments, discarded destructured fields.
    // Without this the convention reads as an error everywhere it is used.
    "no-unused-vars": [
      "error",
      { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
    ],

    // The storefront and theme scripts run in someone else's page, where
    // reading localStorage or touching a global can throw for reasons that are
    // none of our business. Swallowing those deliberately is the point, so an
    // empty catch is intent rather than an oversight. Any other empty block is
    // still an error.
    "no-empty": ["error", { allowEmptyCatch: true }],
  },

  overrides: [
    // React
    {
      files: ["**/*.{js,jsx,ts,tsx}"],
      plugins: ["react", "jsx-a11y", "import"],
      extends: [
        "plugin:react/recommended",
        "plugin:react/jsx-runtime",
        "plugin:react-hooks/recommended",
        "plugin:jsx-a11y/recommended",
      ],
      settings: {
        react: {
          version: "detect",
        },
        formComponents: ["Form"],
        linkComponents: [
          { name: "Link", linkAttribute: "to" },
          { name: "NavLink", linkAttribute: "to" },
        ],
        "import/resolver": {
          typescript: {
            alwaysTryTypes: true,
          },
        },
      },
      rules: {
        "react/no-unknown-property": ["error", { ignore: ["variant"] }],

        // A broken relative path in a .jsx file used to surface only as a
        // dev-server "failed to resolve import" at runtime, because the import
        // plugin was wired up for TypeScript files alone.
        "import/no-unresolved": "error",

        // This app does not use PropTypes anywhere — the typed surfaces are
        // TypeScript and the rest are plain components. Demanding a PropTypes
        // block on every one of them reported ~800 errors for a convention the
        // codebase has never followed, which buried the findings that mattered.
        "react/prop-types": "off",

        // Our SSR-safe layout effect is a real effect hook, so its dependencies
        // deserve the same checking as useEffect's.
        "react-hooks/exhaustive-deps": [
          "warn",
          { additionalHooks: "useIsomorphicLayoutEffect" },
        ],
      },
    },

    // Typescript
    {
      files: ["**/*.{ts,tsx}"],
      plugins: ["@typescript-eslint", "import"],
      parser: "@typescript-eslint/parser",
      settings: {
        "import/internal-regex": "^~/",
        "import/resolver": {
          node: {
            extensions: [".ts", ".tsx"],
          },
          typescript: {
            alwaysTryTypes: true,
          },
        },
      },
      extends: [
        "plugin:@typescript-eslint/recommended",
        "plugin:import/recommended",
        "plugin:import/typescript",
      ],
    },

    // Node
    {
      files: [
        ".eslintrc.cjs",
        "vite.config.{js,ts}",
        ".graphqlrc.{js,ts}",
        "shopify.server.{js,ts}",
        "**/*.server.{js,ts}",
        // The Express backend and the repo's scripts are Node programs. Without
        // this they were linted as browser code, so every `process`, `__dirname`
        // and `Buffer` reported as an undefined variable and buried whatever
        // real problems the linter found.
        "server/**/*.js",
        "scripts/**/*.js",
      ],
      env: {
        node: true,
      },
    },

    // Server tests. The Jest-style suites take their globals from the runner;
    // the `node:test` suites import theirs and are unaffected by this.
    {
      files: ["server/**/*.test.js", "server/**/__tests__/**/*.js"],
      env: {
        node: true,
        jest: true,
      },
    },

    // App tests run under Vitest with `globals: true`, so `describe`, `it` and
    // `expect` are injected rather than imported.
    {
      files: ["app/**/*.test.{js,jsx,ts,tsx}", "app/**/__tests__/**/*.{js,jsx,ts,tsx}"],
      env: {
        jest: true,
      },
    },

    // Storefront and theme extension scripts are plain browser code that talks
    // to the globals Shopify puts on the page.
    {
      files: ["storefront/**/*.js", "extensions/**/*.js"],
      globals: {
        Shopify: "readonly",
      },
    },

    // The storefront script is one `'use strict'` IIFE, which makes a function
    // declared inside a block genuinely block-scoped. The hazard this rule
    // guards — sloppy-mode hoisting out of the block — cannot happen here, and
    // ESLint 8 has no option to allow only the well-defined case.
    {
      files: ["storefront/storefront-script.js"],
      rules: {
        "no-inner-declarations": "off",
      },
    },
  ],
  // `process.env` in client code is replaced at build time by Vite, so the
  // identifier is legitimate here even though there is no Node at runtime.
  globals: {
    shopify: "readonly",
    process: "readonly",
  },
};
