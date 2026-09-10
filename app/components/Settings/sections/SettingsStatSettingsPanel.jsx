import { Banner, Select, TextField } from '@shopify/polaris';
import SettingsInfoLink from '../SettingsInfoLink';
import styles from '../../SmartPricing/classic/SmartPricingClassic.module.css';

function FieldLabel({ htmlFor, children, hash, label }) {
  return (
    <div className={styles.labelRow}>
      <label className={styles.label} htmlFor={htmlFor}>
        {children}
      </label>
      <SettingsInfoLink hash={hash} label={label || children} />
    </div>
  );
}

/**
 * The two settings that decide when a test may be called.
 *
 * Confidence sits first even though the sample floor acts first, because
 * confidence is the one merchants come here to change — two options, a real
 * trade-off — while the sample floor is a number most shops set once. The note
 * under both fields carries the ordering that the layout no longer implies.
 *
 * Each field says only what it is; the reasoning lives on its info icon, which
 * shows the guide summary on hover and the full guide on click.
 *
 * @param {{
 *   loading?: boolean, saving?: boolean, message?: string | null, error?: string | null,
 *   confidenceLevel: unknown, onConfidenceLevel: (value: string) => void,
 *   minSampleSize: unknown, onMinSampleSize: (value: string) => void
 * }} props
 */
export default function SettingsStatSettingsPanel({
  loading = false,
  saving = false,
  message = null,
  error = null,
  confidenceLevel,
  onConfidenceLevel,
  minSampleSize,
  onMinSampleSize,
}) {
  const disabled = loading || saving;
  return (
    <div>
      {loading ? (
        <div style={{ marginBottom: 16 }}>
          <Banner tone="info" title="Loading stat settings…" />
        </div>
      ) : null}
      {message ? (
        <div style={{ marginBottom: 16 }}>
          <Banner tone="success" title={message} />
        </div>
      ) : null}
      {error ? <p className={styles.error}>{error}</p> : null}

      <div className={styles.field}>
        <FieldLabel htmlFor="confidence-level" hash="confidence" label="Confidence level">
          Confidence level
        </FieldLabel>
        <Select
          id="confidence-level"
          label="Confidence level"
          labelHidden
          options={[
            { label: '90% (recommended)', value: '90' },
            { label: '95% (stricter)', value: '95' },
          ]}
          value={String(confidenceLevel ?? '90')}
          disabled={disabled}
          onChange={onConfidenceLevel}
        />
        <p className={styles.help}>How sure the maths must be before calling a winner.</p>
      </div>

      <div className={styles.field}>
        <FieldLabel htmlFor="min-sample-default" hash="min-sample" label="Minimum sample">
          Minimum sample size per variation
        </FieldLabel>
        <TextField
          id="min-sample-default"
          label="Minimum sample size per variation"
          labelHidden
          type="number"
          min={1}
          max={1000000}
          value={String(minSampleSize ?? '')}
          disabled={disabled}
          onChange={onMinSampleSize}
          autoComplete="off"
          helpText="Visitors each variation must reach before anything is calculated."
        />
      </div>

      {/* The one thing neither field can say on its own: they are a sequence,
          not two independent numbers. Without it, the confidence level reads as
          the only gate and merchants expect calls the sample floor is holding
          back. Everything else moved to the info icons. */}
      <p className={styles.help}>
        Sample size decides when the maths may start; confidence decides when it may call a
        winner. Both apply to experiments launched from now on.
      </p>
    </div>
  );
}
