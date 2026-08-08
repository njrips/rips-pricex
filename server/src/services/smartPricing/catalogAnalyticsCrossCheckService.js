/**
 * Compare measured storefront traffic vs order-based estimates for transparency.
 */

function buildTrafficCrossCheck(row = {}) {
  const measured = Number(row.measured_views_30d) || 0;
  const visitors = Number(row.visitors_30d) || 0;
  const units = Number(row.units_sold_30d) || 0;

  if (measured <= 0 || visitors <= 0) {
    return null;
  }

  const ratio = Number((measured / visitors).toFixed(2));
  let driftLevel = 'aligned';
  if (ratio < 0.45 || ratio > 2.2) {
    driftLevel = 'high_drift';
  } else if (ratio < 0.65 || ratio > 1.6) {
    driftLevel = 'moderate_drift';
  }

  return {
    measured_views_30d: measured,
    estimated_visitors_30d: visitors,
    views_to_estimate_ratio: ratio,
    units_sold_30d: units,
    drift_level: driftLevel,
    uses_measured: row.traffic_source === 'storefront_measured',
  };
}

function enrichSkuRowWithTrafficCrossCheck(row = {}) {
  const crossCheck = buildTrafficCrossCheck(row);
  if (!crossCheck) {
    return row;
  }
  const tags = Array.isArray(row.tags) ? [...row.tags] : [];
  if (crossCheck.drift_level === 'high_drift' && !tags.includes('traffic_drift')) {
    tags.push('traffic_drift');
  }
  return {
    ...row,
    traffic_cross_check: crossCheck,
    tags,
  };
}

function enrichSkuRowsWithTrafficCrossCheck(rows = []) {
  return rows.map(enrichSkuRowWithTrafficCrossCheck);
}

function summarizeTrafficCrossChecks(rows = []) {
  let compared = 0;
  let highDrift = 0;
  let moderateDrift = 0;
  rows.forEach(row => {
    const check = row.traffic_cross_check;
    if (!check) {
      return;
    }
    compared += 1;
    if (check.drift_level === 'high_drift') {
      highDrift += 1;
    } else if (check.drift_level === 'moderate_drift') {
      moderateDrift += 1;
    }
  });
  return {
    compared_sku_count: compared,
    high_drift_count: highDrift,
    moderate_drift_count: moderateDrift,
  };
}

module.exports = {
  buildTrafficCrossCheck,
  enrichSkuRowWithTrafficCrossCheck,
  enrichSkuRowsWithTrafficCrossCheck,
  summarizeTrafficCrossChecks,
};
