/** Goals & Metrics slim stub — Classic goal picker works with local/empty defs. */
import { apiGet, apiPost, unwrapData } from './api';

export async function getGoalMetricDefinitions(domain) {
  try {
    const res = await apiGet('/smart-pricing/status', domain ? { domain } : {});
    unwrapData(res);
  } catch {
    // ignore
  }
  return [];
}

export async function saveGoalMetricDefinition(domain, body) {
  return {
    id: body?.id || `goal_${Date.now()}`,
    ...body,
  };
}
