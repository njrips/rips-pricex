/**
 * Express flow — one round-trip from AI picks to batch plans.
 */

const { listOpportunities } = require('./opportunityService');
const { createBatchFromSelection } = require('./batchService');

async function quickStartBatch({
  shopDomain = '',
  accessToken = '',
  variantIds = null,
  scenarioPreset = 'recommended',
} = {}) {
  const opportunityList = await listOpportunities({
    shopDomain,
    accessToken,
    filter: 'all',
  });

  const ids =
    Array.isArray(variantIds) && variantIds.length
      ? variantIds.map(id => String(id).trim()).filter(Boolean)
      : opportunityList.default_selected_variant_ids || [];

  if (opportunityList.source === 'catalog_unavailable') {
    return {
      batch_id: null,
      shop_domain: shopDomain,
      plans: [],
      summary: {
        total: 0,
        ready: 0,
        underpowered: 0,
        estimated_traffic: 0,
        stagger_recommended: false,
      },
      missing_variant_ids: ids,
      guardrails: null,
      launch_capacity: null,
      selected_variant_ids: ids,
      scenario_preset: scenarioPreset,
      express: true,
      source: opportunityList.source,
      connection: opportunityList.connection || null,
      warnings: opportunityList.warnings || [],
      error:
        opportunityList.connection?.message ||
        opportunityList.warnings?.[0] ||
        'Live catalog unavailable.',
    };
  }

  if (!ids.length) {
    return {
      batch_id: null,
      shop_domain: shopDomain,
      plans: [],
      summary: {
        total: 0,
        ready: 0,
        underpowered: 0,
        estimated_traffic: 0,
        stagger_recommended: false,
      },
      missing_variant_ids: [],
      guardrails: null,
      launch_capacity: null,
      selected_variant_ids: [],
      scenario_preset: scenarioPreset,
      express: true,
      source: opportunityList.source || 'catalog',
      warnings: [
        ...(opportunityList.warnings || []),
        'No eligible products found in your catalog yet.',
      ],
      error: 'No eligible products found in your catalog yet.',
    };
  }

  const batch = await createBatchFromSelection({
    shopDomain,
    accessToken,
    variantIds: ids,
    scenarioPreset,
  });

  return {
    ...batch,
    selected_variant_ids: ids,
    scenario_preset: scenarioPreset,
    express: true,
    source: opportunityList.source || 'catalog',
    connection: opportunityList.connection || null,
    warnings: opportunityList.warnings || [],
  };
}

module.exports = {
  quickStartBatch,
};
