import { Banner, Checkbox, Select, TextField } from '@shopify/polaris';
import SettingsInfoLink from '../SettingsInfoLink';
import { ABSOLUTE_MIN_CONVERSIONS_PER_VARIATION } from '../../SmartPricing/classic/sampleSizePolicy';
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
 * @param {{
 *   loading?: boolean, saving?: boolean, message?: string | null, error?: string | null,
 *   maxChange: unknown, onMaxChange: (value: string) => void,
 *   maxRevenueDrop: unknown, onMaxRevenueDrop: (value: string) => void,
 *   minMargin: unknown, onMinMargin: (value: string) => void,
 *   defaultCogs: unknown, onDefaultCogs: (value: string) => void,
 *   confidenceLevel: unknown, onConfidenceLevel: (value: string) => void,
 *   statisticalPower: unknown, onStatisticalPower: (value: string) => void,
 *   mdePercent: unknown, onMdePercent: (value: string) => void,
 *   minSampleSize: unknown, onMinSampleSize: (value: string) => void,
 *   minConversions: unknown, onMinConversions: (value: string) => void,
 *   scenarioPreset: string, onScenarioPreset: (value: string) => void,
 *   autoRound2: boolean, onAutoRound2: (checked: boolean) => void,
 *   maxLearningRounds?: unknown, onMaxLearningRounds?: (value: string) => void,
 *   autoApplyWinner: boolean, onAutoApplyWinner: (checked: boolean) => void,
 *   autoApplyDelayDays: unknown, onAutoApplyDelayDays: (value: string) => void,
 *   winnerReadyNotify: boolean, onWinnerReadyNotify: (checked: boolean) => void,
 *   notificationEmail: unknown, onNotificationEmail: (value: string) => void
 * }} props
 */
export default function SettingsGuardrailsPanel({
  loading = false,
  saving = false,
  message = null,
  error = null,
  maxChange,
  onMaxChange,
  maxRevenueDrop,
  onMaxRevenueDrop,
  minMargin,
  onMinMargin,
  defaultCogs,
  onDefaultCogs,
  confidenceLevel,
  onConfidenceLevel,
  statisticalPower,
  onStatisticalPower,
  mdePercent,
  onMdePercent,
  minSampleSize,
  onMinSampleSize,
  minConversions,
  onMinConversions,
  scenarioPreset,
  onScenarioPreset,
  autoRound2,
  onAutoRound2,
  maxLearningRounds = '3',
  onMaxLearningRounds,
  autoApplyWinner = false,
  onAutoApplyWinner,
  autoApplyDelayDays = '3',
  onAutoApplyDelayDays,
  winnerReadyNotify = true,
  onWinnerReadyNotify,
  notificationEmail = '',
  onNotificationEmail,
}) {
  const disabled = loading || saving;
  return (
    <div>
      {loading ? (
        <div style={{ marginBottom: 16 }}>
          <Banner tone="info" title="Loading guardrails…" />
        </div>
      ) : null}
      {message ? (
        <div style={{ marginBottom: 16 }}>
          <Banner tone="success" title={message} />
        </div>
      ) : null}
      {error ? <p className={styles.error}>{error}</p> : null}

      <div className={styles.sectionLabel}>Price safety</div>
      <div className={styles.field}>
        <FieldLabel htmlFor="max-change" hash="max-price-change" label="Max price change">
          Max price change %
        </FieldLabel>
        {/* Ranges mirror the server clamps in smartPricingGuardrailsService so
            the field cannot invite a value that would be silently narrowed. */}
        <TextField
          id="max-change"
          label="Max price change %"
          labelHidden
          type="number"
          min={3}
          max={30}
          value={String(maxChange ?? '')}
          disabled={disabled}
          onChange={onMaxChange}
          autoComplete="off"
          helpText="Between 3% and 30%. Caps how far any test price can move from the current price."
        />
      </div>
      <div className={styles.field}>
        <FieldLabel htmlFor="max-revenue-drop" hash="max-revenue-drop" label="Max revenue drop">
          Max revenue drop %
        </FieldLabel>
        <TextField
          id="max-revenue-drop"
          label="Max revenue drop %"
          labelHidden
          type="number"
          min={3}
          max={50}
          value={String(maxRevenueDrop ?? '')}
          disabled={disabled}
          onChange={onMaxRevenueDrop}
          autoComplete="off"
        />
      </div>
      <div className={styles.field}>
        <FieldLabel htmlFor="min-margin" hash="min-margin" label="Min margin">
          Min margin %
        </FieldLabel>
        <TextField
          id="min-margin"
          label="Min margin %"
          labelHidden
          type="number"
          min={10}
          max={80}
          value={String(minMargin ?? '')}
          disabled={disabled}
          onChange={onMinMargin}
          autoComplete="off"
          helpText="Between 10% and 80%. Test prices are kept above this margin floor."
        />
      </div>
      <div className={styles.field}>
        <FieldLabel htmlFor="default-cogs" hash="default-cogs" label="Default COGS">
          Default COGS %
        </FieldLabel>
        <TextField
          id="default-cogs"
          label="Default COGS %"
          labelHidden
          type="number"
          min={5}
          max={95}
          value={String(defaultCogs ?? '')}
          disabled={disabled}
          onChange={onDefaultCogs}
          autoComplete="off"
          helpText="Between 5% and 95%. Used to estimate margin for products with no cost in Shopify."
        />
      </div>

      <div className={styles.sectionLabel}>Experiment defaults</div>
      <div style={{ marginBottom: 16 }}>
        <Banner tone="info">
          These apply to experiments you launch from now on. Tests already running keep the
          settings they launched with, so their results stay valid.
        </Banner>
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
      </div>
      <div className={styles.field}>
        <FieldLabel htmlFor="statistical-power" hash="min-sample" label="Planning power">
          Planning power
        </FieldLabel>
        <Select
          id="statistical-power"
          label="Planning power"
          labelHidden
          options={[
            { label: '80% (recommended)', value: '80' },
            { label: '90% (larger sample)', value: '90' },
          ]}
          value={String(statisticalPower ?? '80')}
          disabled={disabled}
          onChange={onStatisticalPower}
        />
      </div>
      <div className={styles.field}>
        <FieldLabel htmlFor="target-lift" hash="target-lift" label="Target lift">
          Target lift
        </FieldLabel>
        <Select
          id="target-lift"
          label="Target lift"
          labelHidden
          options={[
            { label: '8%', value: '8' },
            { label: '10% (recommended)', value: '10' },
            { label: '15%', value: '15' },
          ]}
          value={String(mdePercent ?? '10')}
          disabled={disabled}
          onChange={onMdePercent}
        />
      </div>
      <div className={styles.field}>
        <FieldLabel htmlFor="min-sample-default" hash="min-sample" label="Minimum sample">
          Minimum sample per variation
        </FieldLabel>
        <TextField
          id="min-sample-default"
          label="Minimum sample per variation"
          labelHidden
          type="number"
          min={1}
          max={1000000}
          value={String(minSampleSize ?? '')}
          disabled={disabled}
          onChange={onMinSampleSize}
          autoComplete="off"
        />
      </div>
      <div className={styles.field}>
        <FieldLabel
          htmlFor="min-conversions-default"
          hash="min-conversions"
          label="Minimum conversions"
        >
          Minimum conversions per variation
        </FieldLabel>
        <TextField
          id="min-conversions-default"
          label="Minimum conversions per variation"
          labelHidden
          type="number"
          min={ABSOLUTE_MIN_CONVERSIONS_PER_VARIATION}
          max={2000}
          value={String(minConversions ?? '')}
          disabled={disabled}
          onChange={onMinConversions}
          autoComplete="off"
          helpText="No winner is called until every variation reaches this many conversions, however many visitors it has seen."
        />
      </div>
      <div className={styles.field}>
        <FieldLabel htmlFor="scenario" hash="scenario-preset" label="Default scenario">
          Default scenario preset
        </FieldLabel>
        <Select
          id="scenario"
          label="Default scenario preset"
          labelHidden
          options={[
            { label: 'Conservative', value: 'conservative' },
            { label: 'Recommended', value: 'recommended' },
            { label: 'Aggressive', value: 'aggressive' },
          ]}
          value={scenarioPreset}
          disabled={disabled}
          onChange={onScenarioPreset}
        />
      </div>
      <div className={styles.labelRow}>
        <Checkbox
          label="Email me when a product is ready to apply"
          checked={winnerReadyNotify}
          disabled={disabled}
          onChange={onWinnerReadyNotify}
          helpText="Products in one experiment finish at different times. One email per product, sent the first time it reaches a decision."
        />
        <SettingsInfoLink hash="rollout-queue" label="Ready-to-apply alerts" />
      </div>
      <div className={styles.field}>
        <FieldLabel htmlFor="notify-email" hash="rollout-queue" label="Notification email">
          Notification email
        </FieldLabel>
        <TextField
          id="notify-email"
          label="Notification email"
          labelHidden
          type="email"
          value={String(notificationEmail ?? '')}
          disabled={disabled || !winnerReadyNotify}
          onChange={onNotificationEmail}
          placeholder="Your Shopify store contact email"
          helpText="Leave blank to use the contact address on your Shopify store."
        />
      </div>
      <div className={styles.labelRow}>
        <Checkbox
          label="Write winning prices to Shopify automatically"
          checked={autoApplyWinner}
          disabled={disabled}
          onChange={onAutoApplyWinner}
          helpText="Off by default. When on, a conversion-rate winner confirmed by the exact boundary is written to that product’s catalog price with no further prompt. Revenue and profit goals always wait for your review."
        />
        <SettingsInfoLink hash="auto-apply" label="Automatic price writes" />
      </div>
      <div className={styles.field}>
        <FieldLabel htmlFor="auto-delay" hash="auto-apply" label="Review window">
          Days to wait before an automatic write
        </FieldLabel>
        <TextField
          id="auto-delay"
          label="Days to wait before an automatic write"
          labelHidden
          type="number"
          min={0}
          max={30}
          value={String(autoApplyDelayDays ?? '')}
          disabled={disabled || !autoApplyWinner}
          onChange={onAutoApplyDelayDays}
          helpText="Counted from the moment a product reaches a decision and you are emailed about it. Set to 0 to apply as soon as the evidence lands."
        />
      </div>
      <div className={styles.labelRow}>
        <Checkbox
          label="Auto-start round 2 by default"
          checked={autoRound2}
          disabled={disabled}
          onChange={onAutoRound2}
          helpText="After a product’s winning variation is written to Shopify, queue a follow-up test for that SKU."
        />
        <SettingsInfoLink hash="scenario-preset" label="Auto-start round 2" />
      </div>
      <div className={styles.field}>
        <FieldLabel htmlFor="max-rounds" hash="scenario-preset" label="Learning rounds">
          Maximum learning rounds per product
        </FieldLabel>
        <Select
          id="max-rounds"
          label="Maximum learning rounds per product"
          labelHidden
          options={[
            { label: '1 (no follow-up rounds)', value: '1' },
            { label: '2', value: '2' },
            { label: '3 (recommended)', value: '3' },
          ]}
          value={String(maxLearningRounds ?? '3')}
          disabled={disabled}
          onChange={onMaxLearningRounds}
        />
      </div>
    </div>
  );
}
