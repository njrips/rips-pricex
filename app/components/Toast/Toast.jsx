import React, { useEffect } from 'react';

/** Admin / Polaris-aligned toast (success / critical surfaces). */
function Toast({ message, type = 'success', onClose, duration = 3000 }) {
  useEffect(() => {
    if (!message) return undefined;
    const t = setTimeout(() => onClose?.(), duration);
    return () => clearTimeout(t);
  }, [message, duration, onClose]);

  if (!message) return null;
  const isError = type === 'error';
  const bg = isError ? '#fee8eb' : '#cdfed4';
  const color = isError ? '#8e1f0b' : '#0c5132';
  const border = isError ? '#fda9b5' : '#aee9bb';
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
