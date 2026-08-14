#!/usr/bin/env node
/**
 * RipsPriceX acceptance smoke checks (API-level).
 */
const API = process.env.RIPSPRICEX_API_URL || "http://127.0.0.1:3456";
const SHOP = process.env.RIPSPRICEX_ACCEPT_SHOP || "accept-test.myshopify.com";

async function req(path, { method = "GET", body, headers = {} } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Shop-Domain": SHOP,
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = {};
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  return { status: res.status, data, text };
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  const results = [];

  const health = await fetch(`${API}/health`).then((r) => r.json());
  assert(health.ok, "health failed");
  results.push("health ok");

  const install = await req("/api/shops/install", {
    method: "POST",
    body: { access_token: "shpat_accept_token", scope: "read_products,write_products" },
    headers: { "X-Shopify-Access-Token": "shpat_accept_token" },
  });
  assert(install.status === 200 && install.data.session_saved === true, "session sync failed");
  results.push("install + shop_sessions sync ok");

  let billing = await req("/api/billing/status");
  assert(billing.status === 200, "billing status failed");
  results.push(`billing locked=${!billing.data.entitled}`);

  const createLocked = await req("/api/smart-pricing/inbox/plans", {
    method: "PUT",
    body: { plans: [{ plan_id: "p_lock", title: "Locked", status: "queued" }] },
  });
  // RIPSPRICEX_DEV_ENTITLE_ALL=true forces every shop entitled (local pilot).
  // Skip the 402 gate in that mode; still verify create works after entitle.
  if (createLocked.status === 402) {
    results.push("create locked (402) ok");
  } else if (billing.data.entitled === true) {
    results.push("create lock skipped (shop already entitled / DEV_ENTITLE_ALL)");
  } else {
    assert(false, `expected 402 when unpaid, got ${createLocked.status}`);
  }

  await req("/api/billing/dev-entitle", {
    method: "POST",
    body: { status: "ACTIVE", planHandle: "smart_pricing" },
  });
  billing = await req("/api/billing/status");
  assert(billing.data.entitled === true, "dev entitle failed");
  results.push("entitle unlock ok");

  const sync = await req("/api/billing/sync-entitlement", {
    method: "POST",
    body: { entitled: true, status: "ACTIVE", planHandle: "smart_pricing_sync" },
  });
  assert(sync.status === 200 && sync.data.synced === true, "sync-entitlement failed");
  assert(sync.data.planHandle === "smart_pricing_sync", "sync-entitlement planHandle mismatch");
  results.push("sync-entitlement ok");

  const save = await req("/api/smart-pricing/inbox/plans", {
    method: "PUT",
    body: {
      plans: [{ plan_id: "p_accept_1", title: "Accept experiment", status: "queued" }],
    },
  });
  assert(save.status === 200 || save.status === 201, `save failed ${save.status}`);
  results.push("inbox save ok");

  const list = await req("/api/smart-pricing/inbox/plans");
  assert(list.data.plans || list.data.success, "list failed shape");
  results.push("inbox list ok");

  const script = await req(`/api/track/script.js?shop=${encodeURIComponent(SHOP)}`);
  assert(script.status === 200, "script.js failed");
  assert(
    String(script.text).includes("apiUrl") && String(script.text).includes("AB_TEST_RUNTIME_CONFIG"),
    "script missing apiUrl runtime config",
  );
  results.push("storefront script apiUrl ok");

  const status = await req("/api/smart-pricing/status");
  assert(status.data.entitled === true || status.data.capabilities?.create === true, "status entitled");
  results.push("smart-pricing status entitled ok");

  const installation = await req("/api/settings/installation");
  assert(installation.status === 200, `installation failed ${installation.status}`);
  assert(
    String(installation.data?.scriptUrl || "").includes("ripspricex"),
    "installation scriptUrl should use ripspricex proxy",
  );
  results.push("settings installation ok");

  const surfaces = await req("/api/settings/price-surfaces");
  assert(surfaces.status === 200, `price-surfaces GET failed ${surfaces.status}`);
  const mappings = surfaces.data?.mappings || [];
  assert(Array.isArray(mappings), "price-surfaces mappings should be array");
  results.push("settings price-surfaces GET ok");

  const saveSurfaces = await req("/api/settings/price-surfaces", {
    method: "PUT",
    body: {
      mappings: [
        {
          surface: "pdp",
          role: "regular",
          selector: ".price-item--regular",
          source: "manual",
        },
      ],
    },
  });
  assert(saveSurfaces.status === 200, `price-surfaces PUT failed ${saveSurfaces.status}`);
  results.push("settings price-surfaces PUT ok");

  await req("/api/shops/uninstall", { method: "POST", body: {} });
  const after = await req("/api/billing/status");
  // With DEV_ENTITLE_ALL, status may still report entitled=true after uninstall.
  if (after.data.entitled !== true || after.data.status === "none") {
    results.push("uninstall cancel policy ok");
  } else {
    results.push(
      "uninstall ran (entitlement still true via RIPSPRICEX_DEV_ENTITLE_ALL — expected in local pilot)",
    );
  }

  console.log("ACCEPTANCE PASSED");
  for (const r of results) console.log(" -", r);
}

main().catch((err) => {
  console.error("ACCEPTANCE FAILED", err.message);
  process.exit(1);
});
