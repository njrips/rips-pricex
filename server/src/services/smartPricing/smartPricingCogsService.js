/**
 * Per-SKU COGS overrides for Smart Pricing margin accuracy.
 */

const { query } = require('../../utils/database');
const { normalizeVariantGid } = require('./smartPricingCatalogUtils');

const MAX_OVERRIDES = 500;

function kvKey(shopDomain) {
  return `smart_pricing_cogs.${String(shopDomain || '')
    .trim()
    .toLowerCase()}`;
}

function parseMoney(value) {
  const num = Number.parseFloat(String(value ?? '').trim());
  return Number.isFinite(num) && num >= 0 ? num : null;
}

function normalizeOverrideRow(row = {}) {
  const variantId = normalizeVariantGid(row.variant_id || row.variantId);
  const unitCost = parseMoney(row.unit_cost ?? row.unitCost ?? row.cost);
  if (!variantId || unitCost === null) {
    return null;
  }
  return {
    variant_id: variantId,
    unit_cost: Number(unitCost.toFixed(4)),
    sku: String(row.sku || '').trim() || null,
    updated_at: row.updated_at || new Date().toISOString(),
  };
}

async function getSkuCogsOverrides(shopDomain) {
  const shop = String(shopDomain || '')
    .trim()
    .toLowerCase();
  if (!shop) {
    return { overrides: {}, summary: { count: 0 } };
  }
  try {
    const result = await query('SELECT value FROM key_value_store WHERE key = $1 LIMIT 1', [
      kvKey(shop),
    ]);
    const raw = result.rows?.[0]?.value;
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const overrides =
      parsed?.overrides && typeof parsed.overrides === 'object' ? parsed.overrides : {};
    return {
      overrides,
      summary: {
        count: Object.keys(overrides).length,
        updated_at: parsed?.updated_at || null,
      },
    };
  } catch {
    return { overrides: {}, summary: { count: 0 } };
  }
}

async function saveSkuCogsOverrides(shopDomain, overrides = {}) {
  const shop = String(shopDomain || '')
    .trim()
    .toLowerCase();
  if (!shop) {
    throw new Error('shopDomain is required');
  }
  const normalized = {};
  Object.entries(overrides).forEach(([variantId, row]) => {
    const entry = normalizeOverrideRow({ variant_id: variantId, ...(row || {}) });
    if (entry) {
      normalized[entry.variant_id] = entry;
    }
  });
  const keys = Object.keys(normalized);
  if (keys.length > MAX_OVERRIDES) {
    throw new Error(`COGS overrides limited to ${MAX_OVERRIDES} variants`);
  }
  const payload = {
    overrides: normalized,
    updated_at: new Date().toISOString(),
  };
  await query(
    `INSERT INTO key_value_store (key, value, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (key)
     DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [kvKey(shop), JSON.stringify(payload)]
  );
  return { overrides: normalized, summary: { count: keys.length, updated_at: payload.updated_at } };
}

function parseCsvRows(text = '') {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
  if (!lines.length) {
    return [];
  }
  const header = lines[0].split(',').map(h => h.trim().toLowerCase());
  const variantIdx = header.findIndex(h => h === 'variant_id' || h === 'variantid');
  const costIdx = header.findIndex(h => ['unit_cost', 'unitcost', 'cost', 'cogs'].includes(h));
  const skuIdx = header.findIndex(h => h === 'sku');
  if (variantIdx < 0 || costIdx < 0) {
    throw new Error('CSV must include variant_id and unit_cost columns');
  }
  return lines.slice(1).map(line => {
    const cols = line.split(',').map(c => c.trim());
    return normalizeOverrideRow({
      variant_id: cols[variantIdx],
      unit_cost: cols[costIdx],
      sku: skuIdx >= 0 ? cols[skuIdx] : '',
    });
  });
}

async function importSkuCogsFromCsv(shopDomain, csvText) {
  const rows = parseCsvRows(csvText).filter(Boolean);
  if (!rows.length) {
    throw new Error('No valid COGS rows found in import');
  }
  const existing = await getSkuCogsOverrides(shopDomain);
  const merged = { ...(existing.overrides || {}) };
  rows.forEach(row => {
    merged[row.variant_id] = row;
  });
  const saved = await saveSkuCogsOverrides(shopDomain, merged);
  return {
    imported_count: rows.length,
    total_count: saved.summary.count,
    overrides: saved.overrides,
  };
}

function resolveUnitCostWithOverrides(variantId, shopifyUnitCost, overrides = {}) {
  const normalizedId = normalizeVariantGid(variantId);
  if (
    normalizedId &&
    overrides[normalizedId]?.unit_cost !== null &&
    overrides[normalizedId]?.unit_cost !== undefined
  ) {
    return {
      unit_cost: overrides[normalizedId].unit_cost,
      margin_source: 'imported_cogs',
    };
  }
  const shopifyCost = parseMoney(shopifyUnitCost);
  if (shopifyCost !== null) {
    return { unit_cost: shopifyCost, margin_source: 'unit_cost' };
  }
  return { unit_cost: null, margin_source: null };
}

module.exports = {
  getSkuCogsOverrides,
  saveSkuCogsOverrides,
  importSkuCogsFromCsv,
  resolveUnitCostWithOverrides,
  normalizeOverrideRow,
};
