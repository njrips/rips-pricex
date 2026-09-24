import { useCallback, useEffect, useMemo, useState } from 'react';
import { Banner, Checkbox } from '@shopify/polaris';
import SettingsInfoLink from '../SettingsInfoLink';
import CodeSnippetEditor, { parseSnippetErrorLine } from '../primitives/CodeSnippetEditor';
import {
  validateGlobalCssSnippet,
  validateGlobalJavascriptSnippet,
} from '../../../utils/merchantStorefrontSnippets';
import settingsStyles from '../Settings.module.css';
import styles from '../../SmartPricing/classic/SmartPricingClassic.module.css';

const INNER_TABS = [
  { id: 'js', label: 'JavaScript' },
  { id: 'css', label: 'CSS' },
];

function shortStatusMessage(error, fallbackOk) {
  if (!error) return fallbackOk;
  const raw = String(error);
  const withoutPrefix = raw.replace(/^Line \d+:\s*/i, '');
  if (withoutPrefix.length <= 72) return withoutPrefix;
  return `${withoutPrefix.slice(0, 69)}…`;
}

export default function SettingsGlobalAssetsPanel({
  loading = false,
  saving = false,
  message = null,
  error = null,
  css,
  js,
  cssEnabled,
  jsEnabled,
  onCss,
  onJs,
  onCssEnabled,
  onJsEnabled,
  limits = {},
}) {
  const [innerTab, setInnerTab] = useState('js');
  const [jsDiagnostic, setJsDiagnostic] = useState({ error: null, valid: true });
  const [cssDiagnostic, setCssDiagnostic] = useState({ error: null, valid: true });
  const disabled = loading || saving;
  const maxCss = limits.max_css_chars ?? 32 * 1024;
  const maxJs = limits.max_js_chars ?? 64 * 1024;

  const runJsCheck = useCallback(
    value => {
      if (!jsEnabled || !String(value || '').trim()) {
        setJsDiagnostic({ error: null, valid: true });
        return true;
      }
      const check = validateGlobalJavascriptSnippet(value);
      setJsDiagnostic({ error: check.valid ? null : check.error, valid: check.valid });
      return check.valid;
    },
    [jsEnabled]
  );

  const runCssCheck = useCallback(
    value => {
      if (!cssEnabled || !String(value || '').trim()) {
        setCssDiagnostic({ error: null, valid: true });
        return true;
      }
      const check = validateGlobalCssSnippet(value);
      setCssDiagnostic({ error: check.valid ? null : check.error, valid: check.valid });
      return check.valid;
    },
    [cssEnabled]
  );

  useEffect(() => {
    const timer = window.setTimeout(() => runJsCheck(js), 320);
    return () => window.clearTimeout(timer);
  }, [js, jsEnabled, runJsCheck]);

  useEffect(() => {
    const timer = window.setTimeout(() => runCssCheck(css), 320);
    return () => window.clearTimeout(timer);
  }, [css, cssEnabled, runCssCheck]);

  const jsError = jsDiagnostic.error || (error && innerTab === 'js' ? error : null);
  const cssError = cssDiagnostic.error || (error && innerTab === 'css' ? error : null);

  const jsStatus = useMemo(() => {
    if (!jsEnabled) return { tone: 'idle', message: 'Disabled' };
    if (!String(js || '').trim()) return { tone: 'ok', message: 'Empty snippet' };
    if (jsError) return { tone: 'error', message: shortStatusMessage(jsError, '') };
    return { tone: 'ok', message: 'No problems detected' };
  }, [js, jsEnabled, jsError]);

  const cssStatus = useMemo(() => {
    if (!cssEnabled) return { tone: 'idle', message: 'Disabled' };
    if (!String(css || '').trim()) return { tone: 'ok', message: 'Empty snippet' };
    if (cssError) return { tone: 'error', message: shortStatusMessage(cssError, '') };
    return { tone: 'ok', message: 'No problems detected' };
  }, [css, cssEnabled, cssError]);

  const enabled = innerTab === 'js' ? jsEnabled : cssEnabled;
  const onEnabledChange = innerTab === 'js' ? onJsEnabled : onCssEnabled;

  return (
    <div>
      {message ? (
        <div style={{ marginBottom: 16 }}>
          <Banner tone="success" title={message} />
        </div>
      ) : null}

      <div className={settingsStyles.globalAssetsToolbar}>
        <div className={styles.pillRow} role="tablist" aria-label="Snippet type">
          {INNER_TABS.map(tab => {
            const active = innerTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                className={`${styles.pill} ${active ? styles.pillActive : ''}`}
                disabled={disabled}
                onClick={() => setInnerTab(tab.id)}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
        <div className={settingsStyles.globalAssetsToolbarActions}>
          <Checkbox label="Enabled" checked={enabled} disabled={disabled} onChange={onEnabledChange} />
          <SettingsInfoLink hash="global-snippets" label="Global snippets" />
        </div>
      </div>

      {innerTab === 'js' ? (
        <CodeSnippetEditor
          id="global-js-snippet"
          value={js}
          onChange={onJs}
          onBlur={() => runJsCheck(js)}
          disabled={disabled || !jsEnabled}
          maxLength={maxJs}
          languageLabel="JavaScript"
          statusTone={jsStatus.tone}
          statusMessage={jsStatus.message}
          errorLine={parseSnippetErrorLine(jsError)}
          rows={18}
        />
      ) : (
        <CodeSnippetEditor
          id="global-css-snippet"
          value={css}
          onChange={onCss}
          onBlur={() => runCssCheck(css)}
          disabled={disabled || !cssEnabled}
          maxLength={maxCss}
          languageLabel="CSS"
          statusTone={cssStatus.tone}
          statusMessage={cssStatus.message}
          errorLine={parseSnippetErrorLine(cssError)}
          rows={18}
        />
      )}
    </div>
  );
}
