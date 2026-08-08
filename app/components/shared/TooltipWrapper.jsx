/**
 * TooltipWrapper Component
 *
 * Wraps Polaris Tooltip for consistent tooltip usage across the app.
 * Use for buttons, icons, and other elements that need hover hints.
 */

import React from 'react';
import { Tooltip } from '@shopify/polaris';

/**
 * TooltipWrapper - Shows a tooltip on hover
 *
 * @param {React.ReactNode} children - Element that activates the tooltip
 * @param {string|React.ReactNode} content - Tooltip content (keep concise to avoid blocking)
 * @param {string} [accessibilityLabel] - Screen reader label
 * @param {string} [preferredPosition] - 'above' | 'below' | 'mostSpace' - avoids blocking
 * @param {number} [hoverDelay] - ms before showing (reduces accidental triggers)
 */
function TooltipWrapper({
  children,
  content,
  accessibilityLabel,
  preferredPosition = 'mostSpace',
  hoverDelay = 400,
}) {
  if (!content) return children;
  return (
    <Tooltip
      content={content}
      accessibilityLabel={accessibilityLabel}
      preferredPosition={preferredPosition}
      hoverDelay={hoverDelay}
    >
      {children}
    </Tooltip>
  );
}

export default TooltipWrapper;
