import { useCallback, useEffect, useMemo, useRef } from 'react';
import settingsStyles from '../Settings.module.css';

/**
 * Lightweight code editor: line gutter, monospace area, VS Code–style status bar.
 *
 * @param {{
 *   id?: string,
 *   value: string,
 *   onChange: (value: string) => void,
 *   onBlur?: () => void,
 *   disabled?: boolean,
 *   maxLength?: number,
 *   placeholder?: string,
 *   statusMessage?: string | null,
 *   statusTone?: 'ok' | 'error' | 'idle' | 'warn',
 *   errorLine?: number | null,
 *   languageLabel?: string,
 *   rows?: number,
 * }} props
 */
export default function CodeSnippetEditor({
  id,
  value,
  onChange,
  onBlur,
  disabled = false,
  maxLength,
  placeholder = '',
  statusMessage = null,
  statusTone = 'ok',
  errorLine = null,
  languageLabel = 'Code',
  rows = 16,
}) {
  const textareaRef = useRef(null);
  const gutterLinesRef = useRef(null);

  const lines = useMemo(() => {
    const text = String(value ?? '');
    const count = Math.max(1, text.split('\n').length);
    return Array.from({ length: count }, (_, i) => i + 1);
  }, [value]);

  // Moved rather than scrolled: the numbers sit outside layout so they never
  // make the editor taller than its textarea, and a transform can follow the
  // textarea all the way down past its horizontal scrollbar.
  const syncScroll = useCallback(() => {
    const ta = textareaRef.current;
    const gutterLines = gutterLinesRef.current;
    if (!ta || !gutterLines) return;
    gutterLines.style.transform = `translateY(${-ta.scrollTop}px)`;
  }, []);

  useEffect(() => {
    syncScroll();
  }, [value, syncScroll]);

  const handleChange = event => {
    let next = event.target.value;
    if (maxLength && next.length > maxLength) {
      next = next.slice(0, maxLength);
    }
    onChange(next);
  };

  const statusClass = [
    settingsStyles.codeEditorStatusBar,
    statusTone === 'error' ? settingsStyles.codeEditorStatusError : '',
    statusTone === 'idle' ? settingsStyles.codeEditorStatusIdle : '',
    statusTone === 'warn' ? settingsStyles.codeEditorStatusWarn : '',
  ]
    .filter(Boolean)
    .join(' ');

  const displayStatus =
    statusMessage ||
    (statusTone === 'ok' ? 'No problems detected' : statusTone === 'idle' ? 'Disabled' : '');

  return (
    <div
      className={`${settingsStyles.codeEditorShell} ${disabled ? settingsStyles.codeEditorDisabled : ''}`}
    >
      <div className={settingsStyles.codeEditorSurface}>
        <div
          className={settingsStyles.codeEditorGutter}
          aria-hidden
          style={{ width: `calc(${String(lines.length).length}ch + 18px)` }}
        >
          <div ref={gutterLinesRef} className={settingsStyles.codeEditorGutterLines}>
          {lines.map(line => (
            <div
              key={line}
              className={[
                settingsStyles.codeEditorGutterLine,
                errorLine === line ? settingsStyles.codeEditorGutterLineError : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              {line}
            </div>
          ))}
          </div>
        </div>
        <textarea
          ref={textareaRef}
          id={id}
          className={settingsStyles.codeEditorInput}
          value={value}
          onChange={handleChange}
          onBlur={onBlur}
          onScroll={syncScroll}
          disabled={disabled}
          placeholder={placeholder}
          spellCheck={false}
          wrap="off"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          rows={rows}
          aria-invalid={statusTone === 'error'}
          aria-describedby={id ? `${id}-status` : undefined}
        />
      </div>
      <div id={id ? `${id}-status` : undefined} className={statusClass} role="status">
        <span className={settingsStyles.codeEditorStatusLang}>{languageLabel}</span>
        <span className={settingsStyles.codeEditorStatusMessage} title={displayStatus || undefined}>
          {displayStatus}
        </span>
        <span className={settingsStyles.codeEditorStatusMeta}>
          {lines.length} {lines.length === 1 ? 'line' : 'lines'}
          {maxLength ? ` · ${String(value || '').length}/${maxLength}` : ''}
        </span>
      </div>
    </div>
  );
}

/** @param {string | null | undefined} error */
export function parseSnippetErrorLine(error) {
  if (!error) return null;
  const match = String(error).match(/^Line (\d+):/i);
  if (!match) return null;
  const line = Number.parseInt(match[1], 10);
  return Number.isFinite(line) ? line : null;
}
