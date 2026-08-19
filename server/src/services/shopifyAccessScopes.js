/**
 * Read the app's currently granted Admin API scopes for a shop.
 */

function getShopifyService() {
  return require('./shopifyService');
}

async function fetchCurrentAccessScopes(shopDomain, accessToken) {
  if (!shopDomain || !accessToken) return [];
  const queryText = `
    query rpxCurrentAccessScopes {
      currentAppInstallation {
        accessScopes {
          handle
        }
      }
    }
  `;
  const response = await getShopifyService().requestAdminGraphql(
    shopDomain,
    accessToken,
    queryText
  );
  const rows = response?.data?.currentAppInstallation?.accessScopes || [];
  return rows.map(row => String(row?.handle || '').trim()).filter(Boolean);
}

function formatScopeList(scopes = []) {
  return [...new Set((Array.isArray(scopes) ? scopes : []).map(s => String(s || '').trim()).filter(Boolean))]
    .sort()
    .join(',');
}

module.exports = {
  fetchCurrentAccessScopes,
  formatScopeList,
};
