import React, { useEffect } from 'react';

/**
 * Admin / Polaris-aligned toast.
 *
 * `warning` exists for outcomes that are neither: an action that applied to
 * some of an experiment's products and not others is something the merchant
 * has to come back to, and reporting it in the success colour read as done.
 */
const TOAST_TONES = {
  error: { bg: '#fee8eb', color: '#8e1f0b', border: '#fda9b5' },
  warning: { bg: '#fff5ea', color: '#8a6116', border: '#ffd79d' },
  success: { bg: '#cdfed4', color: '#0c5132', border: '#aee9bb' },
};

function Toast({ message, type = 'success', onClose, duration = 3000 }) {
  useEffect(() => {
    if (!message) return undefined;
    const t = setTimeout(() => onClose?.(), duration);
    return () => clearTimeout(t);
  }, [message, duration, onClose]);

  if (!message) return null;
  const { bg, color, border } = TOAST_TONES[type] || TOAST_TONES.success;
  return (
    <div
      role="status"
      style={{
        position: 'fixed',
        top: 16,
        right: 16,
        zIndex: 9999,
        background: bg,
        color,
        border: `1px solid ${border}`,
        padding: '10px 14px',
        borderRadius: 8,
        boxShadow: '0 1px 0 rgba(0,0,0,0.05)',
        maxWidth: 360,
        fontSize: 13,
        fontFamily:
          'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        fontWeight: 500,
      }}
    >
      {message}
    </div>
  );
}

export default React.memo(Toast);
