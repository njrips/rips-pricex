import { useEffect, useMemo, useState } from "react";
import { useOutletContext, useSearchParams } from "react-router";
import { TitleBar } from "@shopify/app-bridge-react";
import { Banner, BlockStack, Box, Button, Card, InlineStack, Text, TextField } from "@shopify/polaris";
import type { AppOutletContext } from "../lib/api.client";
import { rpxApi } from "../lib/api.client";
import { apiGet, apiPost, getShopDomain } from "../services/api";
import { StoreSettingsPriceSurfacesSection } from "../components/Settings/sections/StoreSettingsPriceSurfacesSection";

type TabId = "guardrails" | "installation" | "price-surfaces";

const TABS: { id: TabId; label: string }[] = [
  { id: "guardrails", label: "Guardrails" },
  { id: "installation", label: "Installation" },
  { id: "price-surfaces", label: "Price surfaces" },
];

function normalizeTab(raw: string | null): TabId {
  const value = String(raw || "")
    .trim()
    .toLowerCase();
  if (value === "installation" || value === "setup") return "installation";
  if (value === "price-surfaces" || value === "price_surfaces" || value === "surfaces") {
    return "price-surfaces";
  }
  return "guardrails";
}

export default function SettingsPage() {
  const ctx = useOutletContext<AppOutletContext>();
  const shopDomain = ctx.shop || getShopDomain();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = normalizeTab(searchParams.get("tab"));
  const automap = searchParams.get("automap") === "1";
  const [autoMapToken, setAutoMapToken] = useState(0);

  const [maxUp, setMaxUp] = useState("20");
  const [maxDown, setMaxDown] = useState("20");
  const [minMargin, setMinMargin] = useState("0");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [installSnippet, setInstallSnippet] = useState("");
  const [scriptUrl, setScriptUrl] = useState("");
  const [cartStatus, setCartStatus] = useState<string>("Checking…");
  const [cartBusy, setCartBusy] = useState(false);
  const [cartError, setCartError] = useState<string | null>(null);

  useEffect(() => {
    if (tab === "price-surfaces" && automap) {
      setAutoMapToken((n) => n + 1);
    }
  }, [tab, automap]);

  useEffect(() => {
    rpxApi
      .getGuardrails(ctx)
      .then((data: unknown) => {
        const g =
          (data as { guardrails?: Record<string, number> }).guardrails ||
          (data as Record<string, number>);
        if (g.max_price_increase_pct != null) setMaxUp(String(g.max_price_increase_pct));
        if (g.max_price_decrease_pct != null) setMaxDown(String(g.max_price_decrease_pct));
        if (g.min_margin_pct != null) setMinMargin(String(g.min_margin_pct));
      })
      .catch(() => {});
  }, [ctx.shop]);

  useEffect(() => {
    if (tab !== "installation") return;
    let cancelled = false;
    apiGet("/settings/installation")
      .then((res) => {
        if (cancelled) return;
        const data = res?.data?.data || res?.data || {};
        setInstallSnippet(String(data.snippetHtml || ""));
        setScriptUrl(String(data.scriptUrl || ""));
      })
      .catch(() => {
        if (!cancelled) setInstallSnippet("");
      });
    apiGet("/settings/cart-transform/status")
      .then((res) => {
        if (cancelled) return;
        const data = res?.data || {};
        if (data.installedForRipxFunction) {
          setCartStatus("Cart transform installed for this app");
        } else if (data.function?.id) {
          setCartStatus("Function found — not installed yet (click Ensure)");
        } else {
          setCartStatus("No cart transform function found — deploy the extension first");
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setCartStatus("Could not load cart transform status");
          setCartError(e?.response?.data?.error || e?.message || "Status failed");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [tab, shopDomain]);

  const setTab = (next: TabId) => {
    const params = new URLSearchParams(searchParams);
    params.set("tab", next);
    if (next !== "price-surfaces") params.delete("automap");
    setSearchParams(params, { replace: true });
  };

  const saveGuardrails = async () => {
    setMessage(null);
    setError(null);
    try {
      await rpxApi.saveGuardrails(ctx, {
        max_price_increase_pct: Number(maxUp),
        max_price_decrease_pct: Number(maxDown),
        min_margin_pct: Number(minMargin),
      });
      setMessage("Guardrails saved");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    }
  };

  const ensureCartTransform = async () => {
    setCartBusy(true);
    setCartError(null);
    try {
      const res = await apiPost("/settings/cart-transform/ensure", {});
      const data = res?.data || {};
      setCartStatus(
        data.created
          ? "Cart transform installed"
          : data.assumedInstalled
            ? "Cart transform already present (assumed)"
            : "Cart transform already installed",
      );
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      setCartError(err?.response?.data?.error || err?.message || "Ensure failed");
    } finally {
      setCartBusy(false);
    }
  };

  const title = useMemo(() => {
    if (tab === "installation") return "Installation";
    if (tab === "price-surfaces") return "Price surfaces";
    return "Settings";
  }, [tab]);

  return (
    <s-page heading={title}>
      <TitleBar title={title}>
        {tab === "guardrails" ? (
          <button variant="primary" onClick={saveGuardrails}>
            Save
          </button>
        ) : null}
      </TitleBar>

      <Box paddingBlockEnd="400">
        <InlineStack gap="200" wrap>
          {TABS.map((item) => (
            <Button
              key={item.id}
              variant={tab === item.id ? "primary" : "secondary"}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </Button>
          ))}
        </InlineStack>
      </Box>

      {tab === "guardrails" ? (
        <s-section heading="Price guardrails">
          <s-stack direction="block" gap="base">
            {message ? <s-banner tone="success">{message}</s-banner> : null}
            {error ? <s-banner tone="critical">{error}</s-banner> : null}
            <s-text-field
              label="Max price increase %"
              value={maxUp}
              onChange={(e: Event) => setMaxUp((e.target as HTMLInputElement).value)}
            />
            <s-text-field
              label="Max price decrease %"
              value={maxDown}
              onChange={(e: Event) => setMaxDown((e.target as HTMLInputElement).value)}
            />
            <s-text-field
              label="Min margin %"
              value={minMargin}
              onChange={(e: Event) => setMinMargin((e.target as HTMLInputElement).value)}
            />
          </s-stack>
        </s-section>
      ) : null}

      {tab === "installation" ? (
        <BlockStack gap="400">
          <Card>
            <Box padding="400">
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Theme embed & app proxy
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Enable the RipsPriceX theme app embed, then confirm the storefront script loads via
                  app proxy.
                </Text>
                {scriptUrl ? (
                  <Text as="p" variant="bodySm">
                    Script URL: <code>{scriptUrl}</code>
                  </Text>
                ) : null}
                {installSnippet ? (
                  <Box
                    padding="300"
                    background="bg-surface-secondary"
                    borderRadius="200"
                    overflowX="scroll"
                  >
                    <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: 12 }}>
                      {installSnippet}
                    </pre>
                  </Box>
                ) : null}
              </BlockStack>
            </Box>
          </Card>

          <Card>
            <Box padding="400">
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Cart transform
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Required for charged-price parity at checkout (Plus / development stores).
                </Text>
                <Banner tone="info">{cartStatus}</Banner>
                {cartError ? <Banner tone="critical">{cartError}</Banner> : null}
                <InlineStack gap="200">
                  <Button variant="primary" loading={cartBusy} onClick={ensureCartTransform}>
                    Ensure cart transform
                  </Button>
                  <Button onClick={() => setTab("price-surfaces")}>Open price surfaces</Button>
                </InlineStack>
              </BlockStack>
            </Box>
          </Card>
        </BlockStack>
      ) : null}

      {tab === "price-surfaces" ? (
        <StoreSettingsPriceSurfacesSection
          showAllAppSections
          shopDomain={shopDomain}
          autoMapRequestToken={autoMapToken}
        />
      ) : null}
    </s-page>
  );
}
