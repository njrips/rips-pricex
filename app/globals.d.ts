declare module "*.css";
declare module "*.module.css";
declare module "*.svg";
declare module "*.png";

interface Window {
  __RIPSPRICEX_SHOP__?: string;
  __RIPSPRICEX_API_BASE__?: string;
  /** Injected by App Bridge script from AppProvider */
  shopify?: {
    intents?: { redirect?: (url: string) => void };
    toast?: { show?: (message: string) => void };
    [key: string]: unknown;
  };
}
