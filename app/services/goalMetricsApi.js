import { apiDelete, apiGet, apiPost, unwrapData } from './api';

export async function getGoalMetricDefinitions(domain) {
  const res = await apiGet('/goal-metrics', domain ? { domain } : {});
  const data = unwrapData(res);
  return data?.definitions || res.data?.definitions || [];
}

export async function saveGoalMetricDefinition(domain, definition) {
  const res = await apiPost('/goal-metrics', definition, domain ? { params: { domain } } : {});
  const data = unwrapData(res);
  return data?.definition || res.data?.definition;
}

export function deleteGoalMetricDefinition(domain, id) {
  return apiDelete('/goal-metrics/' + encodeURIComponent(id), domain ? { params: { domain } } : {});
}
