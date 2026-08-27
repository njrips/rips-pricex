-- Staff login OTP: 6-digit code emailed to allowlisted operators.
-- 1 min expiry; rate limit 3 sends per 15 min per email (same as RipX).

CREATE TABLE IF NOT EXISTS staff_login_otp_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL,
  code_hash VARCHAR(64) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_staff_login_otp_email
  ON staff_login_otp_codes (email);

CREATE INDEX IF NOT EXISTS idx_staff_login_otp_expires
  ON staff_login_otp_codes (expires_at);

CREATE INDEX IF NOT EXISTS idx_staff_login_otp_email_created
  ON staff_login_otp_codes (email, created_at);

COMMENT ON TABLE staff_login_otp_codes IS
  '6-digit staff login OTP; 1 min expiry; 3 sends per 15 min per email';
