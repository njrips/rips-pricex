import { Banner, Select, TextField } from '@shopify/polaris';
import LabelWithInfo from '../primitives/LabelWithInfo';
import styles from '../../SmartPricing/classic/SmartPricingClassic.module.css';

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
          <Banner tone="info" title="Loading results settings…" />
        </div>
      ) : null}
      {message ? (
        <div style={{ marginBottom: 16 }}>
          <Banner tone="success" title={message} />
        </div>
      ) : null}
      {error ? <p className={styles.error}>{error}</p> : null}

      <p className={styles.help} style={{ marginTop: 0, marginBottom: 16 }}>
        When Priceify can call a winner.
      </p>

      <div className={styles.field}>
        <LabelWithInfo htmlFor="confidence-level" hash="confidence" label="Confidence level">
          Confidence level
        </LabelWithInfo>
        <Select
          id="confidence-level"
          label="Confidence level"
          labelHidden
          options={[
            { label: '80% (faster, less strict)', value: '80' },
            { label: '90% (recommended)', value: '90' },
            { label: '95% (safer, more strict)', value: '95' },
          ]}
          value={String(confidenceLevel ?? '90')}
          disabled={disabled}
          onChange={onConfidenceLevel}
        />
        <p className={styles.help}>How sure the maths must be before calling a winner.</p>
      </div>

      <div className={styles.field}>
        <LabelWithInfo htmlFor="min-sample-default" hash="min-sample" label="Minimum visitors">
          Minimum visitors per variation
        </LabelWithInfo>
        <TextField
          id="min-sample-default"
          label="Minimum visitors per variation"
          labelHidden
          type="number"
          min={1}
          max={1000000}
          value={String(minSampleSize ?? '')}
          disabled={disabled}
          onChange={onMinSampleSize}
          autoComplete="off"
          helpText="Visitors each variation must reach before results are calculated."
        />
      </div>

      <p className={styles.help}>
        Sample size decides when analysis can start; confidence decides when Priceify may call a
        winner. Both apply to new tests from now on.
      </p>
    </div>
  );
}
