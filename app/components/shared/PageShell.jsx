import React from 'react';
import Toast from '../Toast/Toast';

const DEFAULT_TOAST_DURATION = 3000;
const ERROR_TOAST_DURATION = 5000;

function PageShell({
  children,
  message,
  messageType = 'success',
  onCloseMessage,
  messageDuration,
  className = '',
}) {
  const duration =
    messageDuration ?? (messageType === 'error' ? ERROR_TOAST_DURATION : DEFAULT_TOAST_DURATION);

  return (
    <div
      className={['rpx-page-shell', className].filter(Boolean).join(' ')}
      data-palette="admin"
      style={{ minHeight: '100%', background: 'var(--bg-primary, #f1f1f1)' }}
    >
      {message ? (
        <Toast
          message={message}
          type={messageType}
          onClose={onCloseMessage || (() => {})}
          duration={duration}
        />
      ) : null}
      {children}
    </div>
  );
}

export default React.memo(PageShell);
