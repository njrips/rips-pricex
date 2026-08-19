import React from 'react';
import { useNavigate } from 'react-router';
import { Button } from '@shopify/polaris';
import { TitleBar } from '@shopify/app-bridge-react';
import PageShell from '../../shared/PageShell';
import { ROUTES } from '../../../constants';
import useClassicShopDomain from '../../../hooks/useClassicShopDomain';
import { ButtonIconArrowLeft } from './classicIcons';
import styles from './SmartPricingClassic.module.css';

/**
 * Shared chrome for Setup / Settings — Classic layout, Admin / Polaris controls.
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
      <TitleBar title={titleBar}>
        <button type="button" variant="breadcrumb" onClick={() => navigate(backPath)}>
          Experiments
        </button>
      </TitleBar>
      <div className={styles.page}>
        <div className={styles.topBar}>
          <div className={styles.pageBack}>
            <Button variant="plain" icon={ButtonIconArrowLeft} textAlign="start" onClick={() => navigate(backPath)}>
              {backLabel}
            </Button>
          </div>
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
                <Button
                  variant="plain"
                  url={footerSecondary.href}
                  external={
                    footerSecondary.target === '_top' || footerSecondary.target === '_blank'
                  }
                  onClick={
                    typeof footerSecondary.onClick === 'function'
                      ? event => {
                          event.preventDefault();
                          footerSecondary.onClick(event);
                        }
                      : undefined
                  }
                >
                  {footerSecondary.label}
                </Button>
              ) : (
                <Button
                  variant="plain"
                  onClick={footerSecondary.onClick}
                  disabled={footerSecondary.disabled}
                >
                  {footerSecondary.label}
                </Button>
              )
            ) : (
              <span />
            )}
            <div className={styles.footerActions}>
              {footerPrimary ? (
                <Button
                  variant="primary"
                  onClick={footerPrimary.onClick}
                  disabled={footerPrimary.disabled || footerPrimary.busy}
                  loading={Boolean(footerPrimary.busy)}
                >
                  {footerPrimary.busy
                    ? footerPrimary.busyLabel || 'Working…'
                    : footerPrimary.label}
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </PageShell>
  );
}
