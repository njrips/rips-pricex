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

let reportedHydrationError = false;

async function reportHydrationHeadDifference() {
  if (!import.meta.env.DEV) return;

  try {
    const response = await fetch(window.location.href, {
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "text/html" },
    });
    if (!response.ok) return;

    const serverDocument = new DOMParser().parseFromString(
      await response.text(),
      "text/html",
    );
    const signature = (node: Element) => {
      const attributes = Array.from(node.attributes)
        .map(({ name, value }) => `${name}=${value}`)
        .sort()
        .join(";");
      return `${node.tagName.toLowerCase()}[${attributes}]${
        node.tagName === "TITLE" ? node.textContent || "" : ""
      }`;
    };
    const selectOwnedHead = (root: ParentNode) =>
      Array.from(root.querySelectorAll("head > meta, head > link, head > title")).map(
        signature,
      );
    const serverHead = selectOwnedHead(serverDocument);
    const clientHead = selectOwnedHead(document);

    if (JSON.stringify(serverHead) !== JSON.stringify(clientHead)) {
      console.warn("[ripspricex] hydration head difference", {
        serverOnly: serverHead.filter((item) => !clientHead.includes(item)),
        clientOnly: clientHead.filter((item) => !serverHead.includes(item)),
        serverOrder: serverHead,
        clientOrder: clientHead,
      });
    }
  } catch {
    // Hydration reporting must never affect app startup.
  }
}

startTransition(() => {
  clearBrowserExtensionInjectionsBeforeHydration();
  hydrateRoot(
    document,
    <StrictMode>
      <HydratedRouter />
    </StrictMode>,
    {
      onRecoverableError(error) {
        if (!reportedHydrationError && typeof console !== "undefined" && console.warn) {
          reportedHydrationError = true;
          console.warn("[ripspricex] recoverable hydration issue", error);
          void reportHydrationHeadDifference();
        }
      },
    },
  );
});
