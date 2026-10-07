import { Form, Link, useNavigate } from 'react-router';
import { Badge, Banner, Button, Select, TextField } from '@shopify/polaris';
import {
  TICKET_CATEGORY_OPTIONS,
  TICKET_FILTERS,
  countTicketsByFilter,
  filterTickets,
  formatTicketRelativeTime,
  formatTicketTime,
  ticketCategoryLabel,
  ticketLastMessageLine,
  ticketMerchantHint,
  ticketStatusLabel,
} from './helpFaq';
import styles from './SmartPricingClassic.module.css';

/** Below this many tickets the filters and search are noise, not help. */
export const TICKET_TOOLS_MIN = 6;

/** ⌘/Ctrl + Enter sends, like most chat and email tools. */
function submitOnModEnter(canSubmit) {
  return event => {
    if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey) || !canSubmit) return;
    event.preventDefault();
    event.currentTarget.requestSubmit();
  };
}

export function ticketStatusTone(status) {
  const value = String(status || '').toLowerCase();
  if (value === 'resolved' || value === 'closed') return 'success';
  if (value === 'waiting_merchant') return 'warning';
  if (value === 'waiting_staff') return 'info';
  return undefined;
}

function TicketTable({ tickets, selectedId, helpHref }) {
  const navigate = useNavigate();
  return (
    <div className={styles.tableScroll}>
      <table className={`${styles.table} ${styles.ticketTable}`}>
        <thead>
          <tr>
            <th scope="col">Ticket</th>
            <th scope="col">Subject</th>
            <th scope="col" className={styles.ticketCategoryCol}>
              Category
            </th>
            <th scope="col">Status</th>
            <th scope="col">Updated</th>
          </tr>
        </thead>
        <tbody>
          {tickets.map(ticket => {
            const href = helpHref({ ticket: ticket.public_id });
            const needsReply = String(ticket.status || '').toLowerCase() === 'waiting_merchant';
            const lastLine = ticketLastMessageLine(ticket);
            return (
              <tr
                key={ticket.public_id}
                className={[
                  styles.ticketRow,
                  needsReply ? styles.ticketRowAttention : '',
                  selectedId === ticket.public_id ? styles.ticketRowSelected : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={event => {
                  if (event.target.closest('a')) return;
                  navigate(href);
                }}
              >
                <td className={styles.ticketIdCell}>
                  <Link to={href} className={styles.ticketIdLink}>
                    {ticket.public_id}
                  </Link>
                </td>
                <td className={styles.ticketSubjectCell}>
                  <span className={styles.ticketSubject}>{ticket.subject}</span>
                  {lastLine ? <span className={styles.ticketPreview}>{lastLine}</span> : null}
                </td>
                <td className={`${styles.ticketMetaCell} ${styles.ticketCategoryCol}`}>
                  {ticketCategoryLabel(ticket.category)}
                </td>
                <td>
                  <Badge tone={ticketStatusTone(ticket.status)}>
                    {ticketStatusLabel(ticket.status)}
                  </Badge>
                </td>
                <td className={styles.ticketMetaCell} title={formatTicketTime(ticket.updated_at)}>
                  {formatTicketRelativeTime(ticket.updated_at)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TicketList({
  tickets,
  filter,
  onFilterChange,
  query,
  onQueryChange,
  selectedId,
  helpHref,
}) {
  const navigate = useNavigate();
  const counts = countTicketsByFilter(tickets);
  const showTools = tickets.length >= TICKET_TOOLS_MIN;
  const visible = showTools ? filterTickets(tickets, { filter, query }) : filterTickets(tickets);
  const waiting = visible.find(
    ticket => String(ticket.status || '').toLowerCase() === 'waiting_merchant',
  );
  return (
    <div className={styles.ticketPanel}>
      <div className={styles.ticketToolbar}>
        <div className={styles.ticketToolbarTitle}>
          <h2 className={styles.ticketHeading}>Your tickets</h2>
          <p className={styles.help}>Replies from our team show up here on their own.</p>
        </div>
        <Button
          variant="primary"
          onClick={() => navigate(helpHref({ tab: 'tickets', compose: '1' }))}
        >
          New ticket
        </Button>
      </div>

      {counts.needs_reply > 0 ? (
        <Banner tone="warning">
          <p>
            {counts.needs_reply === 1
              ? 'Our team replied and is waiting on you.'
              : `Our team is waiting on you in ${counts.needs_reply} tickets.`}{' '}
            {waiting ? (
              <Link to={helpHref({ ticket: waiting.public_id })}>Open {waiting.public_id}</Link>
            ) : null}
          </p>
        </Banner>
      ) : null}

      {showTools ? (
        <div className={styles.ticketFilters}>
          <div
            className={`${styles.segment} ${styles.ticketSegment}`}
            role="tablist"
            aria-label="Filter tickets"
          >
            {TICKET_FILTERS.map(item => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={filter === item.id}
                className={`${styles.segmentBtn} ${filter === item.id ? styles.segmentBtnActive : ''}`}
                onClick={() => onFilterChange(item.id)}
              >
                {item.label}
                <span className={styles.ticketFilterCount}>{counts[item.id]}</span>
              </button>
            ))}
          </div>
          <div className={styles.ticketSearch}>
            <TextField
              label="Search tickets"
              labelHidden
              placeholder="Search by id, subject or message"
              value={query}
              onChange={onQueryChange}
              autoComplete="off"
              clearButton
              onClearButtonClick={() => onQueryChange('')}
            />
          </div>
        </div>
      ) : null}

      {visible.length ? (
        <TicketTable tickets={visible} selectedId={selectedId} helpHref={helpHref} />
      ) : (
        <div className={styles.ticketEmpty}>
          <p className={styles.sectionLabel}>No tickets match</p>
          <p className={styles.help}>
            {query ? `Nothing matches “${query}”. ` : 'No tickets in this view. '}
            <Button
              variant="plain"
              onClick={() => {
                onFilterChange('all');
                onQueryChange('');
              }}
            >
              Show all tickets
            </Button>
          </p>
        </div>
      )}
    </div>
  );
}

function NewTicketForm({ draft, onDraftChange, creating, hasTickets, helpHref, error }) {
  const navigate = useNavigate();
  const canSubmit = !creating && Boolean(draft.subject.trim() && draft.body.trim());
  const set = key => value => onDraftChange({ ...draft, [key]: value });
  return (
    <div id="help-new-ticket" className={styles.ticketPanel}>
      {hasTickets ? (
        <Link to={helpHref({ tab: 'tickets', view: 'all' })} className={styles.ticketBackLink}>
          ← All tickets
        </Link>
      ) : null}
      <div className={styles.ticketComposeGrid}>
        <div className={styles.ticketCard}>
          <h2 className={styles.ticketHeading}>New ticket</h2>
          <p className={styles.help} style={{ marginBottom: 16 }}>
            Tell us what you expected and what happened instead. We reply here in Admin.
          </p>
          {error ? (
            <div style={{ marginBottom: 12 }}>
              <Banner tone="critical" title="Your ticket was not sent">
                <p>{error}</p>
              </Banner>
            </div>
          ) : null}
          <Form method="post" onKeyDown={submitOnModEnter(canSubmit)}>
            <input type="hidden" name="intent" value="create" />
            <input type="hidden" name="category" value={draft.category} />
            <input type="hidden" name="subject" value={draft.subject} />
            <input type="hidden" name="body" value={draft.body} />
            <input type="hidden" name="reply_email" value={draft.replyEmail} />
            <div className={styles.ticketFormFields}>
              <div className={styles.ticketFormRow}>
                <Select
                  label="Category"
                  options={TICKET_CATEGORY_OPTIONS}
                  value={draft.category}
                  onChange={set('category')}
                />
                <TextField
                  label="Reply email (optional)"
                  type="email"
                  value={draft.replyEmail}
                  onChange={set('replyEmail')}
                  autoComplete="email"
                  helpText="Only used if we need to reach you outside Admin."
                />
              </div>
              <TextField
                label="Subject"
                value={draft.subject}
                onChange={set('subject')}
                autoComplete="off"
                maxLength={200}
                placeholder="For example: Test prices not showing on the product page"
              />
              <TextField
                label="What happened"
                value={draft.body}
                onChange={set('body')}
                multiline={6}
                autoComplete="off"
                maxLength={8000}
                showCharacterCount
                placeholder="Which page or test, what you did, and what you saw."
              />
              <div className={styles.ticketFormActions}>
                <Button submit variant="primary" loading={creating} disabled={!canSubmit}>
                  {creating ? 'Sending…' : 'Send ticket'}
                </Button>
                {hasTickets ? (
                  <Button onClick={() => navigate(helpHref({ tab: 'tickets', view: 'all' }))}>
                    Cancel
                  </Button>
                ) : null}
              </div>
            </div>
          </Form>
        </div>
        <aside className={`${styles.ticketCard} ${styles.ticketAside}`}>
          <p className={styles.sectionLabel}>Attached automatically</p>
          <ul className={styles.ticketAsideList}>
            <li>Shop domain and plan</li>
            <li>Checkout readiness</li>
            <li>Recent test ids</li>
          </ul>
          <p className={styles.help}>
            You don&apos;t need to look these up. Never paste access tokens or passwords.
          </p>
          <p className={styles.help} style={{ marginTop: 12 }}>
            Quick question? The <Link to={helpHref({ view: 'all' })}>Answers</Link> tab may already
            cover it.
          </p>
        </aside>
      </div>
    </div>
  );
}

function TicketDetail({ ticket, replyBody, onReplyChange, replying, helpHref, error }) {
  const canReply = !replying && Boolean(replyBody.trim());
  const status = String(ticket.status || '').toLowerCase();
  const messages = Array.isArray(ticket.messages) ? ticket.messages : [];
  return (
    <div id="help-ticket" className={styles.ticketPanel}>
      <Link to={helpHref({ tab: 'tickets', view: 'all' })} className={styles.ticketBackLink}>
        ← All tickets
      </Link>
      <div className={styles.ticketCard}>
        <div className={styles.ticketDetailHead}>
          <div>
            <p className={styles.ticketDetailId}>{ticket.public_id}</p>
            <h2 className={styles.ticketHeading}>{ticket.subject}</h2>
            <p className={styles.help}>
              {ticketCategoryLabel(ticket.category)}
              {ticket.created_at ? ` · Opened ${formatTicketTime(ticket.created_at)}` : ''}
              {ticket.updated_at ? ` · Updated ${formatTicketRelativeTime(ticket.updated_at)}` : ''}
            </p>
          </div>
          <Badge tone={ticketStatusTone(ticket.status)}>{ticketStatusLabel(ticket.status)}</Badge>
        </div>

        {status === 'waiting_merchant' ? (
          <Banner tone="warning" title={ticketMerchantHint(ticket.status)} />
        ) : (
          <p className={styles.help}>{ticketMerchantHint(ticket.status)}</p>
        )}

        <ol className={styles.ticketThread} aria-label="Conversation">
          {messages.map(message => {
            const fromSupport = message.author === 'staff';
            return (
              <li
                key={message.id}
                className={`${styles.ticketMessage} ${
                  fromSupport ? styles.ticketMessageSupport : styles.ticketMessageMerchant
                }`}
              >
                <p className={styles.ticketMessageMeta}>
                  <strong>{fromSupport ? 'Priceify support' : 'You'}</strong>
                  {message.created_at ? ` · ${formatTicketTime(message.created_at)}` : ''}
                </p>
                <p className={styles.ticketMessageBody}>{message.body}</p>
              </li>
            );
          })}
        </ol>

        {status !== 'closed' ? (
          <Form method="post" className={styles.ticketReply} onKeyDown={submitOnModEnter(canReply)}>
            {error ? (
              <Banner tone="critical" title="Your reply was not sent">
                <p>{error}</p>
              </Banner>
            ) : null}
            <input type="hidden" name="intent" value="reply" />
            <input type="hidden" name="public_id" value={ticket.public_id} />
            <input type="hidden" name="body" value={replyBody} />
            <TextField
              label="Reply"
              value={replyBody}
              onChange={onReplyChange}
              multiline={3}
              autoComplete="off"
              maxLength={8000}
              placeholder={
                status === 'resolved' ? 'Still not working? Reply to reopen.' : 'Write a reply…'
              }
              helpText="Press ⌘ + Enter (Ctrl + Enter on Windows) to send."
            />
            <div className={styles.ticketFormActions}>
              <Button submit variant="primary" loading={replying} disabled={!canReply}>
                {replying ? 'Sending…' : 'Send reply'}
              </Button>
            </div>
          </Form>
        ) : (
          <p className={styles.help}>
            This ticket is closed.{' '}
            <Link to={helpHref({ tab: 'tickets', compose: '1' })}>Open a new ticket</Link> if you
            still need help.
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Support tab: ticket table, a new-ticket form, or one ticket's conversation,
 * chosen by the URL (`?ticket=`, `?compose=1`) so the browser back button works.
 */
export default function HelpTicketsTab({
  tickets,
  selectedTicket,
  selectedId,
  compose,
  helpHref,
  draft,
  onDraftChange,
  creating,
  replyBody,
  onReplyChange,
  replying,
  filter,
  onFilterChange,
  query,
  onQueryChange,
  formError = null,
  formIntent = '',
}) {
  if (selectedTicket) {
    return (
      <TicketDetail
        ticket={selectedTicket}
        replyBody={replyBody}
        onReplyChange={onReplyChange}
        replying={replying}
        helpHref={helpHref}
        error={formError && formIntent !== 'create' ? formError : null}
      />
    );
  }
  if (compose || !tickets.length) {
    return (
      <NewTicketForm
        draft={draft}
        onDraftChange={onDraftChange}
        creating={creating}
        hasTickets={tickets.length > 0}
        helpHref={helpHref}
        error={formError && formIntent !== 'reply' ? formError : null}
      />
    );
  }
  return (
    <TicketList
      tickets={tickets}
      filter={filter}
      onFilterChange={onFilterChange}
      query={query}
      onQueryChange={onQueryChange}
      selectedId={selectedId}
      helpHref={helpHref}
    />
  );
}
