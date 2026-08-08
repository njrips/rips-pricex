import React from 'react';
import styles from '../SmartPricingClassic.module.css';

export default function ClassicSettingsTab({ settings }) {
  if (!settings) {
    return (
      <div className={styles.statCard}>
        <h3 className={styles.panelTitle}>Settings</h3>
        <p className={styles.help}>Launch settings will appear after the plan is saved.</p>
      </div>
    );
  }

  return (
    <div className={styles.detailStack}>
      <div className={styles.statCard}>
        <h3 className={styles.panelTitle}>Launch preferences</h3>
        <div className={styles.selectionBar}>
          <span>Status</span>
          <strong>{settings.testStatus || '—'}</strong>
        </div>
        <div className={styles.selectionBar}>
          <span>Traffic ramp</span>
          <strong>
            {settings.trafficRampPercent !== null && settings.trafficRampPercent !== undefined
              ? `${settings.trafficRampPercent}%`
              : '—'}
          </strong>
        </div>
        <div className={styles.selectionBar}>
          <span>Canary days</span>
          <strong>
            {settings.canaryDays !== null && settings.canaryDays !== undefined
              ? settings.canaryDays
              : '—'}
          </strong>
        </div>
        <div className={styles.selectionBar}>
          <span>Auto-stop</span>
          <strong>{settings.autoStopEnabled ? 'On' : 'Off'}</strong>
        </div>
        <div className={styles.selectionBar}>
          <span>Price application</span>
          <strong>{settings.priceApplicationMethod || '—'}</strong>
        </div>
        <div className={styles.selectionBar}>
          <span>Scenario preset</span>
          <strong>{settings.scenarioPreset || '—'}</strong>
        </div>
      </div>
      {Array.isArray(settings.guardrailNotes) && settings.guardrailNotes.length ? (
        <div className={styles.statCard}>
          <h3 className={styles.panelTitle}>Shop guardrails</h3>
          {settings.guardrailNotes.map(note => (
            <div key={note} className={styles.selectionBar}>
              <span>{note}</span>
              <strong>Active</strong>
            </div>
          ))}
        </div>
      ) : null}
      <div className={styles.statCard}>
        <h3 className={styles.panelTitle}>Identifiers</h3>
        <div className={styles.selectionBar}>
          <span>Plan ID</span>
          <strong className={styles.monoValue}>{settings.planId || '—'}</strong>
        </div>
        <div className={styles.selectionBar}>
          <span>Test ID</span>
          <strong className={styles.monoValue}>{settings.testId || '—'}</strong>
        </div>
        <p className={styles.help}>
          Shop-wide Smart Pricing defaults live under Smart Pricing → Settings in the list view.
        </p>
      </div>
    </div>
  );
}
