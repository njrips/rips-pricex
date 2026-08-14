import React from 'react';
import { useNavigate } from 'react-router';
import { TitleBar } from '@shopify/app-bridge-react';
import PageShell from '../../shared/PageShell';
import { ROUTES } from '../../../constants';
import useClassicShopDomain from '../../../hooks/useClassicShopDomain';
import { IconArrowLeft } from './classicIcons';
import styles from './SmartPricingClassic.module.css';

/**
 * Shared chrome for Setup / Settings — matches Classic create card UX
 * (cream page, top back link, white card, title + subtitle). Plan is a Settings tab.
 */
export default function ClassicAdminShell({
  titleBar = 'Settings',
  title,
  subtitle,
  meta = null,
  backTo = null,
  backLabel = 'Back to experiments',
  tabs = null,
  activeTab = null,
  onTabChange = null,
  footerPrimary = null,
  footerSecondary = null,
  children,
}) {
  const navigate = useNavigate();
  const shopDomain = useClassicShopDomain();
  const backPath = backTo || ROUTES.appSmartPricing(shopDomain);

  return (
    <PageShell>
      <TitleBar title={titleBar} />
      <div className={styles.page}>
        <div className={styles.topBar}>
          <button type="button" className={styles.backLink} onClick={() => navigate(backPath)}>
            <IconArrowLeft /> {backLabel}
          </button>
          {meta ? <span className={styles.stepOf}>{meta}</span> : <span />}
        </div>

        {Array.isArray(tabs) && tabs.length > 0 ? (
          <div
            className={`${styles.filterPillTrack} ${styles.adminTabTrack}`}
            role="tablist"
            aria-label="Settings sections"
          >
            {tabs.map(tab => {
              const active = tab.id === activeTab;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  className={`${styles.filterPill} ${active ? styles.filterPillActive : ''}`}
                  onClick={() => onTabChange?.(tab.id)}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        ) : null}

        <div className={styles.card}>
          {title ? <h1 className={`${styles.title} ripx-classic-sans`}>{title}</h1> : null}
          {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
          {children}
        </div>

        {footerPrimary || footerSecondary ? (
          <div className={styles.footer}>
            {footerSecondary ? (
              footerSecondary.href ? (
                <a
                  className={styles.footerLink}
                  href={footerSecondary.href}
                  target={footerSecondary.target || '_top'}
                  rel="noopener"
                  onClick={event => {
                    if (typeof footerSecondary.onClick === 'function') {
                      event.preventDefault();
                      footerSecondary.onClick(event);
                    }
                  }}
                >
                  {footerSecondary.label}
                </a>
              ) : (
                <button
                  type="button"
                  className={styles.footerLink}
                  onClick={footerSecondary.onClick}
                  disabled={footerSecondary.disabled}
                >
                  {footerSecondary.label}
                </button>
              )
            ) : (
              <span />
            )}
            <div className={styles.footerActions}>
              {footerPrimary ? (
                <button
                  type="button"
                  className={styles.primaryBtn}
                  onClick={footerPrimary.onClick}
                  disabled={footerPrimary.disabled || footerPrimary.busy}
                >
                  {footerPrimary.busy ? footerPrimary.busyLabel || 'Working…' : footerPrimary.label}
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </PageShell>
  );
}
