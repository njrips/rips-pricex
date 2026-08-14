import { startTransition, StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import { HydratedRouter } from "react-router/dom";

const EXTENSION_NODE_SELECTORS = [
  "grammarly-desktop-integration",
  "grammarly-extension",
  "grammarly-popups",
  "#grammarly-desktop-integration",
  'script[src*="grammarly"]',
  'script[src*="chrome-extension://"]',
  'link[href*="chrome-extension://"]',
  "div[data-lastpass-root]",
  "#shadow-root-lingvanex",
].join(",");

function scrubExtensionAttributes(el: Element | null) {
  if (!el) return;
  for (const attr of Array.from(el.attributes)) {
    const name = attr.name;
    if (
      name.startsWith("data-gr-") ||
      name.startsWith("data-new-gr-") ||
      name.startsWith("data-gramm") ||
      name.startsWith("data-lt-") ||
      name.startsWith("cz-shortcut") ||
      name.startsWith("data-google-") ||
      name === "bis_skin_checked" ||
      name === "spellcheck"
    ) {
      // keep spellcheck=false if we set it; only remove extension-y true injections
      if (name === "spellcheck" && attr.value === "false") continue;
      el.removeAttribute(name);
    }
  }
}

/**
 * Browser extensions mutate <html>/<body> before hydrate. RR hydrates the full document,
 * so mismatches remount #document and briefly strip CSS (looks like styles "clear out").
 */
function clearBrowserExtensionInjectionsBeforeHydration() {
  try {
    scrubExtensionAttributes(document.documentElement);
    scrubExtensionAttributes(document.body);
    document.querySelectorAll(EXTENSION_NODE_SELECTORS).forEach((node) => node.remove());
  } catch {
    // hydrate anyway
  }
}

function pinPublicStylesheets() {
  const pins = Array.from(document.querySelectorAll("link[data-ripx-css]")).map((node) => ({
    key: node.getAttribute("data-ripx-css") || "",
    href: node.getAttribute("href") || "",
  })).filter((pin) => pin.key && pin.href);

  const restore = () => {
    for (const pin of pins) {
      if (document.querySelector(`link[data-ripx-css="${pin.key}"]`)) continue;
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = pin.href;
      link.setAttribute("data-ripx-css", pin.key);
      document.head.appendChild(link);
    }
  };

  restore();
  const observer = new MutationObserver(restore);
  observer.observe(document.head, { childList: true });
}

startTransition(() => {
  clearBrowserExtensionInjectionsBeforeHydration();
  pinPublicStylesheets();
  hydrateRoot(
    document,
    <StrictMode>
      <HydratedRouter />
    </StrictMode>,
    {
      onRecoverableError(error) {
        if (typeof console !== "undefined" && console.warn) {
          console.warn("[ripspricex] recoverable hydration issue", error);
        }
      },
    },
  );
});
