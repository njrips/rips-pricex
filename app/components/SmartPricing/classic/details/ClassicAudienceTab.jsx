import React from 'react';
import styles from '../SmartPricingClassic.module.css';

function joinList(items, empty = 'All') {
  if (!Array.isArray(items) || !items.length) return empty;
  return items.join(', ');
}

export default function ClassicAudienceTab({ audience }) {
  if (!audience) {
    return (
      <div className={styles.statCard}>
        <h3 className={styles.panelTitle}>Audience</h3>
        <p className={styles.help}>Audience targeting is not configured on this plan.</p>
      </div>
    );
  }

  return (
    <div className={styles.detailStack}>
      <div className={styles.statCard}>
        <h3 className={styles.panelTitle}>Who sees this experiment</h3>
        <div className={styles.selectionBar}>
          <span>Customer segment</span>
          <strong>{audience.customer || 'all'}</strong>
        </div>
        <div className={styles.selectionBar}>
          <span>Traffic allocation</span>
          <strong>
            {audience.trafficAllocation !== null && audience.trafficAllocation !== undefined
              ? `${audience.trafficAllocation}%`
              : '—'}
          </strong>
        </div>
        <div className={styles.selectionBar}>
          <span>Devices ({audience.deviceMode})</span>
          <strong>{joinList(audience.devices, audience.device || 'All')}</strong>
        </div>
        <div className={styles.selectionBar}>
          <span>Sources ({audience.sourceMode})</span>
          <strong>{joinList(audience.sources, audience.trafficSource || 'All')}</strong>
        </div>
        <div className={styles.selectionBar}>
          <span>Countries ({audience.countryMode})</span>
          <strong>{joinList(audience.countries, 'All')}</strong>
        </div>
      </div>
      <div className={styles.statCard}>
        <h3 className={styles.panelTitle}>Exclusions</h3>
        <div className={styles.selectionBar}>
          <span>Exclude bots</span>
          <strong>{audience.excludeBots ? 'On' : 'Off'}</strong>
        </div>
        <div className={styles.selectionBar}>
          <span>Exclude internal IPs</span>
          <strong>{audience.excludeInternalIps ? 'On' : 'Off'}</strong>
        </div>
        <div className={styles.selectionBar}>
          <span>Inherit shop defaults</span>
          <strong>{audience.inheritDefaults ? 'Yes' : 'No'}</strong>
        </div>
      </div>
    </div>
  );
}
