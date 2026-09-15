import SettingsInfoLink from '../SettingsInfoLink';
import styles from '../../SmartPricing/classic/SmartPricingClassic.module.css';

/**
 * A section or field label with its guide icon beside it, not at the far edge
 * of the row.
 *
 * Every screen that pairs a title with `SettingsInfoLink` should use this
 * rather than hand-rolling a flex row — the old `space-between` pattern put
 * the icon on the opposite side of wide panels, which read as disconnected from
 * the label it explained.
 *
 * @param {object} props
 * @param {import('react').ReactNode} props.children Label text
 * @param {string} props.hash Docs section hash for hover summary and click guide
 * @param {string} [props.label] Accessible name override for the icon
 * @param {string} [props.htmlFor] When set, renders a `<label>` tied to a control
 * @param {string} [props.titleClassName] Defaults to `.label` with htmlFor, else `.sectionLabel`
 * @param {string} [props.className] Extra classes on the row wrapper
 * @param {string} [props.id] Row id for anchors and tests
 */
export default function LabelWithInfo({
  children,
  hash,
  label,
  htmlFor,
  titleClassName,
  className,
  id,
}) {
  const resolvedLabel =
    label || (typeof children === 'string' ? children : String(children || 'Setting'));
  const titleClass = titleClassName || (htmlFor ? styles.label : styles.sectionLabel);
  const rowClass = [styles.titleWithInfo, className].filter(Boolean).join(' ');

  if (htmlFor) {
    return (
      <div className={rowClass} id={id}>
        <label className={titleClass} htmlFor={htmlFor}>
          {children}
        </label>
        {hash ? <SettingsInfoLink hash={hash} label={resolvedLabel} /> : null}
      </div>
    );
  }

  return (
    <div className={rowClass} id={id}>
      <div className={titleClass}>{children}</div>
      {hash ? <SettingsInfoLink hash={hash} label={resolvedLabel} /> : null}
    </div>
  );
}
