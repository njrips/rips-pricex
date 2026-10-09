/**
 * Merchant storefront CSS/JS validation (API save).
 * Keep in sync with app/utils/merchantStorefrontSnippets.js
 */

const GLOBAL_JS_PARAM_NAMES = Object.freeze([
  'window',
  'document',
  'Shopify',
  'RipX',
  'location',
]);

const MAX_GLOBAL_CSS_CHARS = 32 * 1024;
const MAX_GLOBAL_JS_CHARS = 64 * 1024;

function stripUnsafeText(value) {
  return String(value ?? '')
    .replace(/\0/g, '')
    .replace(/\u2028/g, '\n')
    .replace(/\u2029/g, '\n');
}

function normalizeMerchantCssSnippet(raw) {
  let css = stripUnsafeText(raw).trim();
  css = css.replace(/^<style[^>]*>/i, '').replace(/<\/style>\s*$/i, '');
  return css.trim();
}

function normalizeMerchantJsSnippet(raw) {
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

function compileGlobalJavascriptSnippet(code) {
  const normalized = normalizeMerchantJsSnippet(code);
  if (!normalized) {
    return { ok: true, normalized: '', fn: null };
  }
  if (normalized.length > MAX_GLOBAL_JS_CHARS) {
    return {
      ok: false,
      normalized,
      error: `JavaScript must be ${MAX_GLOBAL_JS_CHARS.toLocaleString()} characters or fewer.`,
    };
  }
  try {
    // eslint-disable-next-line no-new-func
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

function validateGlobalJavascriptSnippet(code) {
  const result = compileGlobalJavascriptSnippet(code);
  if (result.ok) {
    return { valid: true, normalized: result.normalized, error: null };
  }
  return { valid: false, normalized: result.normalized, error: result.error || 'Invalid JavaScript' };
}

function hasBalancedCssBraces(css) {
  let depth = 0;
  let quote = '';
  let inComment = false;
  let escaped = false;
  for (let index = 0; index < css.length; index += 1) {
    const char = css[index];
    const next = css[index + 1];
    if (inComment) {
      if (char === '*' && next === '/') {
        inComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        quote = '';
      }
      continue;
    }
    if (char === '/' && next === '*') {
      inComment = true;
      index += 1;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth < 0) return false;
    }
  }
  return depth === 0 && !quote && !inComment;
}

function validateGlobalCssSnippet(code) {
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
  if (!hasBalancedCssBraces(normalized)) {
    return {
      valid: false,
      normalized,
      error: 'CSS has an unmatched brace, quote, or comment.',
    };
  }
  return { valid: true, normalized, error: null };
}

function assertValidGlobalJavascriptSnippet(code) {
  const check = validateGlobalJavascriptSnippet(code);
  if (!check.valid) {
    throw new Error(check.error || 'Global JavaScript could not be saved.');
  }
  return check.normalized;
}

module.exports = {
  GLOBAL_JS_PARAM_NAMES,
  MAX_GLOBAL_CSS_CHARS,
  MAX_GLOBAL_JS_CHARS,
  stripUnsafeText,
  normalizeMerchantCssSnippet,
  normalizeMerchantJsSnippet,
  hasBalancedCssBraces,
  compileGlobalJavascriptSnippet,
  validateGlobalJavascriptSnippet,
  validateGlobalCssSnippet,
  assertValidGlobalJavascriptSnippet,
};
