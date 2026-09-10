/**
 * TooltipWrapper Component
 *
 * Wraps Polaris Tooltip for consistent tooltip usage across the app.
 * Use for buttons, icons, and other elements that need hover hints.
 */

import { Tooltip } from '@shopify/polaris';

/**
 * TooltipWrapper - Shows a tooltip on hover
 *
 * The prop and return types are spelled out so TypeScript callers can use this
 * as a component. Left to inference, the return widens past ReactElement and
 * `.tsx` files reject the tag itself rather than any real mistake.
 *
 * @param {object} props
 * @param {import('react').ReactNode} props.children Element that activates the tooltip
 * @param {import('react').ReactNode} props.content Tooltip content (keep it concise)
 * @param {string} [props.accessibilityLabel] Screen reader label
 * @param {'above' | 'below' | 'mostSpace'} [props.preferredPosition] Avoids blocking content
 * @param {number} [props.hoverDelay] ms before showing (reduces accidental triggers)
 * @returns {import('react').ReactElement}
 */
function TooltipWrapper({
  children,
  content,
  accessibilityLabel,
  preferredPosition = 'mostSpace',
  hoverDelay = 400,
}) {
  // Wrapped rather than returned bare: returning `children` widens the return
  // type to ReactNode, which stops TypeScript callers from seeing this as a
  // component at all.
  if (!content) return <>{children}</>;
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
