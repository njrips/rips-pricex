/// <reference types="vite/client" />
/// <reference types="@react-router/node" />

interface ImportMetaEnv {
  readonly VITE_RIPX_DEV_STOREFRONT_PASSWORD?: string;
  readonly VITE_SHOPIFY_API_KEY?: string;
  readonly DEV: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
