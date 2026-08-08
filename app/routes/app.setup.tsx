import { useEffect, useState } from "react";
import { Link, useOutletContext } from "react-router";
import { TitleBar } from "@shopify/app-bridge-react";
import { Banner, BlockStack, Box, Button, Card, InlineStack, Text } from "@shopify/polaris";
import type { AppOutletContext } from "../lib/api.client";
import { rpxApi } from "../lib/api.client";
import { apiGet, apiPost } from "../services/api";

export default function SetupPage() {
  const ctx = useOutletContext<AppOutletContext>();
  const [ready, setReady] = useState<boolean | null>(null);
  const [hints, setHints] = useState<string[]>([]);
  const [cartStatus, setCartStatus] = useState("Checking cart transform…");
  const [cartBusy, setCartBusy] = useState(false);
  const [cartError, setCartError] = useState<string | null>(null);

  const refreshCart = () => {
    apiGet("/settings/cart-transform/status")
      .then((res) => {
        const data = res?.data || {};
        if (data.installedForRipxFunction) {
          setCartStatus("Cart transform installed for this app");
        } else if (data.function?.id) {
          setCartStatus("Function found — click Ensure to install");
        } else {
          setCartStatus("Deploy ripspricex-cart-transform, then Ensure");
        }
      })
      .catch((e) => {
        setCartStatus("Could not load cart transform status");
        setCartError(e?.response?.data?.error || e?.message || "Status failed");
      });
  };

  useEffect(() => {
    rpxApi
      .checkoutReadiness(ctx)
      .then((data) => {
        setReady(Boolean(data.ready));
        setHints(data.hints || []);
      })
      .catch(() => {
        setReady(false);
        setHints(["Could not load checkout readiness"]);
      });
    refreshCart();
  }, [ctx.shop]);

  const ensureCartTransform = async () => {
    setCartBusy(true);
    setCartError(null);
    try {
      const res = await apiPost("/settings/cart-transform/ensure", {});
      const data = res?.data || {};
      setCartStatus(
        data.created
          ? "Cart transform installed"
          : "Cart transform already installed",
      );
      refreshCart();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      setCartError(err?.response?.data?.error || err?.message || "Ensure failed");
    } finally {
      setCartBusy(false);
    }
  };

  return (
    <s-page heading="Setup">
      <TitleBar title="Setup" />
      <BlockStack gap="400">
        <Card>
          <Box padding="400">
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Storefront & checkout
              </Text>
              <Banner tone={ready ? "success" : "warning"}>
                Checkout readiness:{" "}
                {ready == null ? "Checking…" : ready ? "Ready" : "Needs attention"}
              </Banner>
              <Text as="p" variant="bodySm">
                1. Enable the RipsPriceX theme app embed in Online Store → Themes → Customize
              </Text>
              <Text as="p" variant="bodySm">
                2. Deploy cart transform (`ripspricex-cart-transform`). lineUpdate needs Plus or a
                development store.
              </Text>
              <Text as="p" variant="bodySm">
                3. App proxy path: <code>/apps/ripspricex/script.js</code>
              </Text>
              {hints.length ? (
                <BlockStack gap="100">
                  {hints.map((h) => (
                    <Text key={h} as="p" variant="bodySm" tone="subdued">
                      {h}
                    </Text>
                  ))}
                </BlockStack>
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
              <Banner tone="info">{cartStatus}</Banner>
              {cartError ? <Banner tone="critical">{cartError}</Banner> : null}
              <InlineStack gap="200">
                <Button variant="primary" loading={cartBusy} onClick={ensureCartTransform}>
                  Ensure cart transform
                </Button>
                <Button url="/app/settings?tab=installation">Installation settings</Button>
                <Button url="/app/settings?tab=price-surfaces&automap=1">
                  Auto-map price surfaces
                </Button>
              </InlineStack>
              <Text as="p" variant="bodySm" tone="subdued">
                Classic create Review uses the same Installation and Price surfaces tabs when Fix
                setup / Fix price surfaces is clicked.
              </Text>
              <Link to="/app/settings?tab=price-surfaces">Open theme price selectors →</Link>
            </BlockStack>
          </Box>
        </Card>
      </BlockStack>
    </s-page>
  );
}
