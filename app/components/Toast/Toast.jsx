import React, { useEffect } from 'react';

function Toast({ message, type = 'success', onClose, duration = 3000 }) {
  useEffect(() => {
    if (!message) return undefined;
    const t = setTimeout(() => onClose?.(), duration);
    return () => clearTimeout(t);
  }, [message, duration, onClose]);

  if (!message) return null;
  const bg = type === 'error' ? '#FEE2E2' : '#DCFCE7';
  const color = type === 'error' ? '#991B1B' : '#166534';
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
        padding: '10px 14px',
        borderRadius: 10,
        boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
        maxWidth: 360,
        fontSize: 14,
      }}
    >
      {message}
    </div>
  );
}

export default React.memo(Toast);
