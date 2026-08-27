import React from 'react';
import { Button } from '@shopify/polaris';
import { formatSplitCountryAudienceLabel, resolveCountryLists } from '../countrySelection';
import { formatAudienceFactValue } from '../classicExperimentDetailsHelpers';
import styles from '../SmartPricingClassic.module.css';

function FactCard({ label, value, action, actionLabel, onAction }) {
  return (
    <div className={`${styles.statCard} ${styles.detailFactCard}`}>
      <div className={styles.detailFactHead}>
        <div className={styles.statLabel}>{label}</div>
        {action ? (
          <Button variant="plain" accessibilityLabel={actionLabel || action} onClick={onAction}>
            {action}
          </Button>
        ) : null}
      </div>
      <div className={styles.statValue}>{value}</div>
    </div>
  );
}

export default function ClassicAudienceTab({ audience, onEdit }) {
  if (!audience) {
    return (
      <div className={styles.statCard}>
        <h3 className={styles.panelTitle}>Audience</h3>
        <p className={styles.help}>Audience targeting is not configured on this plan.</p>
      </div>
    );
  }

  const traffic =
    audience.trafficAllocation !== null && audience.trafficAllocation !== undefined
      ? Number(audience.trafficAllocation)
      : null;
  const deviceFallback =
    audience.device && String(audience.device).toLowerCase() !== 'all'
      ? formatAudienceFactValue([audience.device], 'All devices')
      : 'All devices';

  return (
    <div className={styles.detailCardGrid}>
      <FactCard
        label="Segment"
        value={audience.segmentLabel || 'All visitors'}
        action={onEdit ? 'Edit targeting' : null}
        onAction={onEdit}
      />
      <FactCard
        label="Traffic allocation"
        value={Number.isFinite(traffic) ? `${traffic}%` : '—'}
        action={onEdit ? 'Adjust' : null}
        actionLabel="Adjust traffic allocation"
        onAction={onEdit}
      />
      <FactCard
        label="Devices"
        value={formatAudienceFactValue(audience.devices, deviceFallback)}
        action={onEdit ? 'Edit' : null}
        actionLabel="Edit devices"
        onAction={onEdit}
      />
      <FactCard
        label="Countries"
        value={(() => {
          const lists = resolveCountryLists(audience);
          return formatSplitCountryAudienceLabel(lists.includeCountries, lists.excludeCountries);
        })()}
        action={onEdit ? 'Edit' : null}
        actionLabel="Edit countries"
        onAction={onEdit}
      />
    </div>
  );
}
