/**
 * Merchant storefront CSS/JS validation (admin + client save).
 * Keep in sync with server/src/utils/merchantStorefrontSnippets.cjs
 */

export const GLOBAL_JS_PARAM_NAMES = Object.freeze([
  'window',
  'document',
  'Shopify',
  'RipX',
  'location',
]);

export const MAX_GLOBAL_CSS_CHARS = 32 * 1024;
export const MAX_GLOBAL_JS_CHARS = 64 * 1024;

export function stripUnsafeText(value) {
  return String(value ?? '')
    .replace(/\0/g, '')
    .replace(/\u2028/g, '\n')
    .replace(/\u2029/g, '\n');
}

export function normalizeMerchantCssSnippet(raw) {
  let css = stripUnsafeText(raw).trim();
  css = css.replace(/^<style[^>]*>/i, '').replace(/<\/style>\s*$/i, '');
  return css.trim();
}

export function normalizeMerchantJsSnippet(raw) {
  let js = stripUnsafeText(raw).trim();
  js = js.replace(/^<script[^>]*>/i, '').replace(/<\/script>\s*$/i, '');
  return js.trim();
}

function formatJavascriptCompileError(err) {
  const message = err && err.message ? String(err.message) : 'Invalid JavaScript';
  const lineMatch = message.match(/:(\d+):(\d+)/);
  if (lineMatch) {
    return `Line ${lineMatch[1]}: ${message.replace(/^SyntaxError:\s*/i, '')}`;
  }
  return message.replace(/^SyntaxError:\s*/i, '');
}

export function compileGlobalJavascriptSnippet(code) {
  const normalized = normalizeMerchantJsSnippet(code);
  if (!normalized) {
    return { ok: true, normalized: '', fn: null };
  }
  try {
    const fn = new Function(...GLOBAL_JS_PARAM_NAMES, normalized);
    return { ok: true, normalized, fn };
  } catch (err) {
    return {
      ok: false,
      normalized,
      error: formatJavascriptCompileError(err),
    };
  }
}

export function validateGlobalJavascriptSnippet(code) {
  const result = compileGlobalJavascriptSnippet(code);
  if (result.ok) {
    return { valid: true, normalized: result.normalized, error: null };
  }
  return { valid: false, normalized: result.normalized, error: result.error || 'Invalid JavaScript' };
}

export function validateGlobalCssSnippet(code) {
  const normalized = normalizeMerchantCssSnippet(code);
  if (!normalized) {
    return { valid: true, normalized: '', error: null };
  }
  if (normalized.length > MAX_GLOBAL_CSS_CHARS) {
    return {
      valid: false,
      normalized: normalized.slice(0, MAX_GLOBAL_CSS_CHARS),
      error: `CSS must be ${MAX_GLOBAL_CSS_CHARS.toLocaleString()} characters or fewer.`,
    };
  }
  const open = (normalized.match(/{/g) || []).length;
  const close = (normalized.match(/}/g) || []).length;
  if (open !== close) {
    return {
      valid: false,
      normalized,
      error: 'CSS has unmatched { or } braces.',
    };
  }
  return { valid: true, normalized, error: null };
}

export function assertValidGlobalJavascriptSnippet(code) {
  const check = validateGlobalJavascriptSnippet(code);
  if (!check.valid) {
    throw new Error(check.error || 'Global JavaScript could not be saved.');
  }
  return check.normalized;
}
