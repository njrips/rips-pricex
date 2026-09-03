import { useEffect, useRef, useState } from 'react';
import { useHydrated } from '../../../hooks/useHydrated';
import { OTP_LENGTH, normalizeOtpDigits, otpDigitList } from './staffOtp';

const FIRST_OTP_BOX_ID = 'staff-otp-box-0';

export default function StaffOtpBoxes({
  name = 'code',
  disabled = false,
  autoFocus = true,
  onDigitsChange,
}) {
  const [digits, setDigits] = useState(() => otpDigitList(''));
  // The split boxes need JavaScript, so they only take over after hydration.
  const enhanced = useHydrated();
  const refs = useRef([]);
  const code = digits.join('');

  useEffect(() => {
    if (enhanced && autoFocus) refs.current[0]?.focus();
  }, [autoFocus, enhanced]);

  const commit = (nextDigits, focusIndex) => {
    setDigits(nextDigits);
    onDigitsChange?.(nextDigits.join(''));
    const target = refs.current[Math.max(0, Math.min(OTP_LENGTH - 1, focusIndex))];
    target?.focus();
    target?.select?.();
  };

  const onChange = (index, raw) => {
    const incoming = normalizeOtpDigits(raw);
    if (!incoming) {
      const next = [...digits];
      next[index] = '';
      setDigits(next);
      onDigitsChange?.(next.join(''));
      return;
    }
    if (incoming.length > 1) {
      const next = otpDigitList(incoming);
      commit(next, incoming.length >= OTP_LENGTH ? OTP_LENGTH - 1 : incoming.length);
      return;
    }
    const next = [...digits];
    next[index] = incoming;
    commit(next, index < OTP_LENGTH - 1 ? index + 1 : index);
  };

  const onKeyDown = (index, event) => {
    if (event.key === 'Enter' && digits.join('').length !== OTP_LENGTH) {
      event.preventDefault();
      return;
    }
    if (event.key === 'Backspace' && !digits[index] && index > 0) {
      event.preventDefault();
      const next = [...digits];
      next[index - 1] = '';
      commit(next, index - 1);
      return;
    }
    if (event.key === 'ArrowLeft' && index > 0) {
      event.preventDefault();
      refs.current[index - 1]?.focus();
    }
    if (event.key === 'ArrowRight' && index < OTP_LENGTH - 1) {
      event.preventDefault();
      refs.current[index + 1]?.focus();
    }
  };

  const onPaste = (event) => {
    const pasted = normalizeOtpDigits(event.clipboardData?.getData('text'));
    if (!pasted) return;
    event.preventDefault();
    commit(otpDigitList(pasted), pasted.length >= OTP_LENGTH ? OTP_LENGTH - 1 : pasted.length);
  };

  return (
    <div className={enhanced ? 'staff-otp is-enhanced' : 'staff-otp'}>
      {/* Bind the label to whichever field is actually reachable: the first box
          when the split boxes are live, the single fallback input otherwise. A
          real association focuses on click for free, and unlike a click handler
          it also announces the field to a screen reader. */}
      <label className="staff-label" htmlFor={enhanced ? FIRST_OTP_BOX_ID : 'staff-code'}>
        6-digit code
        <input
          id="staff-code"
          className="staff-input staff-otp-fallback"
          name={name}
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={OTP_LENGTH}
          readOnly={enhanced}
          tabIndex={enhanced ? -1 : undefined}
          aria-hidden={enhanced || undefined}
          value={code}
          disabled={disabled}
          onChange={(event) => {
            const next = otpDigitList(event.target.value);
            setDigits(next);
            onDigitsChange?.(next.join(''));
          }}
        />
      </label>
      <div className="staff-otp-boxes" role="group" aria-label="6-digit code" onPaste={onPaste}>
        {digits.map((digit, index) => (
          <input
            key={index}
            id={index === 0 ? FIRST_OTP_BOX_ID : undefined}
            ref={(node) => {
              refs.current[index] = node;
            }}
            className="staff-otp-box"
            type="text"
            inputMode="numeric"
            tabIndex={enhanced ? 0 : -1}
            autoComplete={index === 0 ? 'one-time-code' : 'off'}
            maxLength={index === 0 ? OTP_LENGTH : 1}
            aria-label={`Digit ${index + 1} of ${OTP_LENGTH}`}
            value={digit}
            disabled={disabled}
            onChange={(event) => onChange(index, event.target.value)}
            onKeyDown={(event) => onKeyDown(index, event)}
          />
        ))}
      </div>
    </div>
  );
}
