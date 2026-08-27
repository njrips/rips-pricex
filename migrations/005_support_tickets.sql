-- Shop-scoped merchant support tickets (Help page + staff console).

CREATE TABLE IF NOT EXISTS support_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id VARCHAR(16) NOT NULL UNIQUE,
  shop_domain VARCHAR(255) NOT NULL,
  category VARCHAR(32) NOT NULL,
  subject VARCHAR(200) NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'open',
  reply_email VARCHAR(255),
  diagnostics JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT support_tickets_category_check CHECK (
    category IN ('setup', 'launch', 'preview', 'live', 'offers', 'billing', 'privacy', 'other')
  ),
  CONSTRAINT support_tickets_status_check CHECK (
    status IN ('open', 'waiting_merchant', 'waiting_staff', 'resolved', 'closed')
  )
);

CREATE INDEX IF NOT EXISTS idx_support_tickets_shop_created
  ON support_tickets (shop_domain, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_support_tickets_status_updated
  ON support_tickets (status, updated_at DESC);

CREATE TABLE IF NOT EXISTS support_ticket_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  author VARCHAR(16) NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT support_ticket_messages_author_check CHECK (
    author IN ('merchant', 'staff')
  )
);

CREATE INDEX IF NOT EXISTS idx_support_ticket_messages_ticket
  ON support_ticket_messages (ticket_id, created_at ASC);

COMMENT ON TABLE support_tickets IS 'Shop-scoped merchant support tickets. Deleted on uninstall.';
COMMENT ON COLUMN support_tickets.public_id IS 'Merchant-facing id, e.g. PX-7K2M.';
