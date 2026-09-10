import { useEffect, useRef } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function visibleFocusable(container) {
  // Deliberately attribute-based rather than layout-based: `offsetParent` is
  // null for fixed-position elements (which these dialogs are) and always null
  // under jsdom, so filtering on it would discard every real candidate.
  return Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR)).filter(
    el => !el.hasAttribute('hidden') && el.getAttribute('aria-hidden') !== 'true'
  );
}

/**
 * Keeps keyboard focus inside an open dialog and restores it on close.
 *
 * These dialogs are hand-rolled portals rather than Polaris modals, so nothing
 * stopped Tab from walking out into the page behind them: a keyboard or screen
 * reader user could leave the dialog without closing it and then operate
 * controls they could not see.
 *
 * Nested overlays (the goal picker, the country listbox) render as their own
 * portals outside this container, so while focus sits inside one of those this
 * hook stands down and lets it manage its own keys.
 *
 * @param {boolean} active - Whether the dialog is open.
 * @param {() => void} [onEscape] - Closes the dialog on Escape. Pass it unless
 *   the dialog already handles Escape itself, or keyboard users have no way out
 *   of the trap other than tabbing to the close button.
 * @returns {import('react').RefObject<HTMLElement>} Attach to the dialog element.
 */
export default function useFocusTrap(active, onEscape) {
  const containerRef = useRef(null);
  // Held in a ref so a new callback identity does not re-run the effect below,
  // which would pull focus back to the first control mid-interaction.
  const escapeRef = useRef(onEscape);
  useEffect(() => {
    escapeRef.current = onEscape;
  }, [onEscape]);

  useEffect(() => {
    if (!active || typeof document === 'undefined') return undefined;
    const container = containerRef.current;
    if (!container) return undefined;

    const previouslyFocused = document.activeElement;

    // Move focus in on open, so the first Tab continues inside the dialog
    // instead of resuming from whatever was focused behind it.
    const initial = visibleFocusable(container)[0];
    if (initial) {
      initial.focus();
    } else {
      container.setAttribute('tabindex', '-1');
      container.focus();
    }

    const onKeyDown = event => {
      if (event.key !== 'Tab' && event.key !== 'Escape') return;
      const activeEl = document.activeElement;
      const nested =
        activeEl && typeof activeEl.closest === 'function'
          ? activeEl.closest('[role="dialog"],[role="listbox"]')
          : null;
      if (nested && nested !== container && !container.contains(nested)) return;

      if (event.key === 'Escape') {
        // Without this the trap has no keyboard exit but the close button, and
        // a dialog nested inside another can leave its parent's Escape handler
        // standing down with nothing taking over.
        if (!escapeRef.current) return;
        event.preventDefault();
        event.stopPropagation();
        escapeRef.current();
        return;
      }

      const items = visibleFocusable(container);
      if (!items.length) {
        event.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const outside = !container.contains(activeEl);

      if (event.shiftKey && (activeEl === first || outside)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (activeEl === last || outside)) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      // Send focus back where it came from, or it lands on <body> and the next
      // Tab restarts at the top of the page.
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
        previouslyFocused.focus();
      }
    };
  }, [active]);

  return containerRef;
}
