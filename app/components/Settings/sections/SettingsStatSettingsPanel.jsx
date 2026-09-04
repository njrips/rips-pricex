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
 * They act in sequence rather than independently, which is worth saying on the
 * page: the sample floor decides when the maths is allowed to start, and the
 * confidence level decides when its answer counts as a winner. Presented as two
 * unrelated numbers, merchants read the confidence level as the only gate and
 * expect calls that the sample floor is still holding back.
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

      <div style={{ marginBottom: 16 }}>
        <Banner tone="info" title="How these two work together">
          <p>
            No result is calculated until every variation has reached the minimum sample size.
            Once it has, a variation is only called the winner when the confidence level below is
            reached.
          </p>
          <p>
            A second floor of 100 conversions per variation applies as well, and is not
            configurable: below it a confidence figure would be wrong rather than merely early.
            Whichever floor a test is still short of is the one it names while it collects.
          </p>
          <p>
            These apply to experiments you launch from now on. Tests already running keep the
            settings they launched with, so their results stay valid.
          </p>
        </Banner>
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
          helpText="Visitors every variation must reach before anything is calculated — counted per variation, so the slowest one sets the pace. Applies to every test, so it is no longer asked for when you create one."
        />
      </div>

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
        <p className={styles.help}>
          How sure the maths has to be before a variation is called the winner. 90% accepts about
          a 1-in-10 chance of a false winner, 95% about 1-in-20 — stricter, but it needs more
          traffic and more orders to reach. The percentage shown on a running experiment is the
          evidence collected so far, not this setting; this is the line it has to cross.
        </p>
      </div>
    </div>
  );
}
