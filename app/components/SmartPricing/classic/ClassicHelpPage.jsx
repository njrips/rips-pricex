import { useEffect, useState } from 'react';
import { Form, Link, useNavigation, useRevalidator, useSearchParams } from 'react-router';
import { Badge, Banner, Button, Select, TextField } from '@shopify/polaris';
import LabelWithInfo from '../../Settings/primitives/LabelWithInfo';
import SettingsGuideBody from '../../Settings/SettingsGuideBody';
import { searchDocsNavTopics, searchDocsSections } from '../../public/priceify/docsContent';
import { openPublicDocsHref, publicDocsHref } from '../../Settings/settingsGuideLinks';
import ClassicAdminShell from './ClassicAdminShell';
import {
  HELP_FAQ_ITEMS,
  HELP_GLOSSARY_TERMS,
  HELP_TABS,
  TICKET_CATEGORY_OPTIONS,
  attentionTicketToPrompt,
  countTicketsAwaitingMerchant,
  filterHelpFaq,
  formatTicketTime,
  resolveHelpTab,
  ticketCategoryLabel,
  ticketMerchantHint,
  ticketStatusLabel,
} from './helpFaq';
import { withCurrentEmbeddedSearch } from '../../../utils/shopifyEmbeddedSearch';
import styles from './SmartPricingClassic.module.css';

function statusTone(status) {
  const value = String(status || '').toLowerCase();
  if (value === 'resolved' || value === 'closed') return 'success';
  if (value === 'waiting_merchant') return 'warning';
  if (value === 'waiting_staff') return 'info';
  return undefined;
}


/**
 * @param {{
 *   tickets?: Array<Record<string, any>>,
 *   selectedTicket?: Record<string, any> | null,
 *   staffEmail?: string,
 *   formError?: string | null,
 *   listError?: string | null,
 *   ticketError?: string | null,
 *   formNotice?: string | null
 * }} props
 */
export default function ClassicHelpPage({
  tickets = [],
  selectedTicket = null,
  staffEmail = '',
  formError = null,
  listError = null,
  ticketError = null,
  formNotice = null,
}) {
  const navigation = useNavigation();
  const revalidator = useRevalidator();
  const submitting = navigation.state === 'submitting';
  const creating = submitting && navigation.formData?.get('intent') === 'create';
  const replying = submitting && navigation.formData?.get('intent') === 'reply';
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = String(searchParams.get('ticket') || selectedTicket?.public_id || '').toUpperCase();
  const attentionId = attentionTicketToPrompt(tickets, selectedId);
  const helpHref = (extra = {}) => withCurrentEmbeddedSearch(searchParams, '/app/help', extra);
  const tab = resolveHelpTab(searchParams.get('tab'), {
    hasSelectedTicket: Boolean(selectedTicket),
  });
  const awaitingMerchant = countTicketsAwaitingMerchant(tickets);
  const [faqQuery, setFaqQuery] = useState('');
  const visibleFaq = filterHelpFaq(HELP_FAQ_ITEMS, faqQuery);
  // One search box covers both bodies of help: the troubleshooting answers on
  // this page and the setting guides. Guides are searched only once something
  // is typed — listing all of them unprompted would bury the questions most
  // visits are here for.
  const guideMatches = searchDocsSections(faqQuery);
  const topicMatches = searchDocsNavTopics(faqQuery);
  // A broad word like "winner" matches most of the statistics guides. Showing
  // the closest few keeps the answer scannable; the rest arrive as the search
  // gets more specific.
  const matchingGuides = guideMatches.slice(0, 4);
  const matchingTopics = topicMatches.slice(0, 3);
  const guidesHidden = guideMatches.length - matchingGuides.length;
  const topicsHidden = topicMatches.length - matchingTopics.length;
  const noAnswers =
    visibleFaq.length === 0 && matchingGuides.length === 0 && matchingTopics.length === 0;

  const openGuides = (hash = '') => {
    openPublicDocsHref(publicDocsHref(hash));
  };
  const [category, setCategory] = useState('setup');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [replyEmail, setReplyEmail] = useState(staffEmail || '');
  const [replyBody, setReplyBody] = useState('');

  // Scroll when a different ticket opens, not on every reply that re-renders it.
  const selectedTicketId = selectedTicket?.public_id || '';

  useEffect(() => {
    if (!selectedTicketId) return;
    document.getElementById('help-ticket')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [selectedTicketId]);

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    let id = 0;
    const tick = () => {
      if (document.visibilityState === 'hidden') return;
      if (navigation.state !== 'idle') return;
      if (revalidator.state !== 'idle') return;
      revalidator.revalidate();
    };
    const start = () => {
      if (id) window.clearInterval(id);
      if (document.visibilityState === 'hidden') return;
      id = window.setInterval(tick, 20000);
    };
    const onVisibility = () => {
      start();
      if (document.visibilityState === 'visible') tick();
    };
    start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.clearInterval(id);
    };
  }, [navigation.state, revalidator]);

  const selectTab = nextTab => {
    const params = new URLSearchParams(searchParams);
    if (nextTab === 'answers') {
      params.delete('tab');
      // Leave the open ticket behind, or it would pull the tab straight back.
      params.delete('ticket');
      params.set('view', 'all');
    } else {
      params.set('tab', 'tickets');
    }
    setSearchParams(params, { replace: true });
  };

  return (
    <ClassicAdminShell
      titleBar="Help & docs"
      meta="Support"
      title="Help & docs"
      subtitle="Answers for Setup, launch, and live tests. File a ticket if you still need us — we attach shop diagnostics automatically."
      tabs={HELP_TABS.map(item =>
        item.id === 'tickets' && awaitingMerchant > 0
          ? { ...item, label: `${item.label} (${awaitingMerchant})` }
          : item
      )}
      activeTab={tab}
      onTabChange={selectTab}
      tabsLabel="Help sections"
    >
      {listError ? (
        <div style={{ marginBottom: 16 }}>
          <Banner tone="warning" title={listError} />
        </div>
      ) : null}
      {formError ? (
        <div style={{ marginBottom: 16 }}>
          <Banner tone="critical" title={formError} />
        </div>
      ) : null}
      {ticketError ? (
        <div style={{ marginBottom: 16 }}>
          <Banner tone="warning" title={ticketError} />
        </div>
      ) : null}
      {formNotice ? (
        <div style={{ marginBottom: 16 }}>
          <Banner tone="success" title={formNotice} />
        </div>
      ) : null}
      {attentionId ? (
        <div style={{ marginBottom: 16 }}>
          <Banner tone="warning" title="Support is waiting on you">
            <Link to={helpHref({ ticket: attentionId })}>
              Open {String(attentionId).toUpperCase()}
            </Link>
          </Banner>
        </div>
      ) : null}

      {tab === 'answers' ? (
        <div>
          <LabelWithInfo hash="how-settings-work" label="How Settings apply">
            Test setting guides
          </LabelWithInfo>
          <p className={styles.help} style={{ marginTop: 0, marginBottom: 12 }}>
            Info icons in Create and Settings open the matching guide. Use the icon here for how
            shop defaults apply to a new test.
          </p>
          <p className={styles.help} style={{ marginTop: 0, marginBottom: 20 }}>
            <Button variant="plain" onClick={() => openGuides()}>
              Browse all guides on Priceify
            </Button>
          </p>

          {!faqQuery.trim() ? (
            <>
              <div className={styles.sectionLabel}>Naming glossary</div>
              <p className={styles.help} style={{ marginTop: 0, marginBottom: 8 }}>
                Shared terms across Priceify — tests, metrics, and setup.
              </p>
              <dl className={styles.glossaryList} style={{ marginBottom: 20 }}>
                {HELP_GLOSSARY_TERMS.map(({ term, definition }) => (
                  <div key={term} className={styles.adminRow}>
                    <dt className={styles.adminRowTitle}>{term}</dt>
                    <dd className={styles.adminRowBody} style={{ marginTop: 4, marginLeft: 0 }}>
                      {definition}
                    </dd>
                  </div>
                ))}
              </dl>
            </>
          ) : null}

          <div className={styles.sectionLabel}>Common questions</div>
          <div style={{ maxWidth: 420, margin: '8px 0 12px' }}>
            <TextField
              label="Search questions and setting guides"
              labelHidden
              placeholder="Search questions and setting guides"
              value={faqQuery}
              onChange={setFaqQuery}
              autoComplete="off"
              clearButton
              onClearButtonClick={() => setFaqQuery('')}
            />
          </div>
          <div style={{ display: 'grid', gap: 8, marginBottom: 20 }}>
            {visibleFaq.map((item) => (
              <details key={item.q} className={styles.adminRow}>
                <summary className={styles.adminRowTitle} style={{ cursor: 'pointer' }}>
                  {item.q}
                </summary>
                <p className={styles.adminRowBody} style={{ marginTop: 8 }}>
                  {item.a}
                </p>
              </details>
            ))}
          </div>

          {matchingTopics.length ? (
            <>
              <div className={styles.sectionLabel}>Guide topics</div>
              <p className={styles.help} style={{ marginTop: 0, marginBottom: 8 }}>
                Jump to the same sections as the public Guides page.
                {topicsHidden > 0
                  ? ` Showing ${matchingTopics.length} of ${topicMatches.length} — refine the search for more.`
                  : ''}
              </p>
              <div style={{ display: 'grid', gap: 8, marginBottom: 20 }}>
                {matchingTopics.map((topic) => {
                  const groupId = topic.href.replace(/^#/, '');
                  return (
                    <div key={topic.href} className={styles.adminRow}>
                      <div className={styles.adminRowTitle}>{topic.title}</div>
                      <p className={styles.adminRowBody} style={{ marginTop: 6 }}>
                        {topic.body}
                      </p>
                      <div style={{ marginTop: 8 }}>
                        <Button variant="plain" onClick={() => openGuides(groupId)}>
                          Open on Priceify guides
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          ) : null}

          {matchingGuides.length ? (
            <>
              <div className={styles.sectionLabel}>Setting guides</div>
              <p className={styles.help} style={{ marginTop: 0, marginBottom: 8 }}>
                Each one leads with a short answer. Open the full explanation only if you need it.
                {guidesHidden > 0
                  ? ` Showing the ${matchingGuides.length} closest of ${guideMatches.length} — narrow the search for the rest.`
                  : ''}
              </p>
              <div style={{ display: 'grid', gap: 8, marginBottom: 20 }}>
                {matchingGuides.map((section) => (
                  <div key={section.id} className={styles.adminRow}>
                    <div className={styles.adminRowTitle}>{section.title}</div>
                    <SettingsGuideBody section={section} idPrefix="help-guide" />
                  </div>
                ))}
              </div>
            </>
          ) : null}

          <p className={styles.help}>
            {noAnswers ? `Nothing matches “${faqQuery}”. ` : 'Still stuck? '}
            <Button variant="plain" onClick={() => selectTab('tickets')}>
              Open a support ticket
            </Button>
          </p>
        </div>
      ) : null}

      {/* Unmounted rather than hidden, so the Shopify support menu can tell
          whether the ticket form is really on screen before scrolling to it.
          The drafts below are held in this component, so a tab switch mid-ticket
          cannot lose one. */}
      {tab === 'tickets' ? (
        <div>
        <div className={styles.sectionLabel}>Your tickets</div>
        <p className={styles.help} style={{ marginBottom: 12 }}>
          These ids belong to this shop only. Other stores cannot open them. Support replies appear
          here automatically — this page refreshes itself while you have it open.
        </p>
        {tickets.length === 0 ? (
          <p className={styles.help}>No tickets yet for this shop. File one below.</p>
        ) : (
          <ul className={styles.adminHintList}>
            {tickets.map((ticket) => (
              <li key={ticket.public_id}>
                <Link
                  to={helpHref({ ticket: ticket.public_id })}
                  style={
                    selectedId && ticket.public_id === selectedId
                      ? { fontWeight: 650 }
                      : undefined
                  }
                >
                  {ticket.public_id}
                </Link>
                {' · '}
                {ticket.subject}
                {' · '}
                {ticketCategoryLabel(ticket.category)}
                {' · '}
                <Badge tone={statusTone(ticket.status)}>{ticketStatusLabel(ticket.status)}</Badge>
                {ticket.updated_at ? ` · ${formatTicketTime(ticket.updated_at)}` : ''}
                {ticket.last_message_preview
                  ? ` · ${ticket.last_message_author === 'staff' ? 'Support' : 'You'}: ${ticket.last_message_preview}`
                  : ''}
              </li>
            ))}
          </ul>
        )}

        <div className={styles.sectionLabel} id="help-new-ticket" style={{ marginTop: 28 }}>
          New ticket
        </div>
        <p className={styles.help} style={{ marginBottom: 12 }}>
          We include shop domain, plan, checkout readiness, and recent test ids. Do not paste
          access tokens.
        </p>
        <Form method="post">
          <input type="hidden" name="intent" value="create" />
          <div style={{ display: 'grid', gap: 12, maxWidth: 560 }}>
            <Select
              label="Category"
              options={TICKET_CATEGORY_OPTIONS}
              value={category}
              onChange={setCategory}
            />
            <input type="hidden" name="category" value={category} />
            <input type="hidden" name="subject" value={subject} />
            <input type="hidden" name="body" value={body} />
            <input type="hidden" name="reply_email" value={replyEmail} />
            <TextField
              label="Subject"
              value={subject}
              onChange={setSubject}
              autoComplete="off"
              maxLength={200}
            />
            <TextField
              label="What happened"
              value={body}
              onChange={setBody}
              multiline={5}
              autoComplete="off"
              maxLength={8000}
            />
            <TextField
              label="Reply email (optional)"
              type="email"
              value={replyEmail}
              onChange={setReplyEmail}
              autoComplete="email"
              helpText="We use this if we need to email you outside Admin."
            />
            <div>
              <Button
                submit
                variant="primary"
                loading={creating}
                disabled={creating || !subject.trim() || !body.trim()}
              >
                {creating ? 'Submitting…' : 'Submit ticket'}
              </Button>
            </div>
          </div>
        </Form>

        {selectedTicket ? (
          <div id="help-ticket" className={styles.adminRow} style={{ marginTop: 20 }}>
            <div className={styles.adminRowHead}>
              <p className={styles.adminRowTitle}>
                {selectedTicket.public_id} — {selectedTicket.subject}
              </p>
              <Badge tone={statusTone(selectedTicket.status)}>
                {ticketStatusLabel(selectedTicket.status)}
              </Badge>
            </div>
            {selectedTicket.status === 'waiting_merchant' ? (
              <div style={{ margin: '12px 0' }}>
                <Banner tone="warning" title={ticketMerchantHint(selectedTicket.status)} />
              </div>
            ) : (
              <p className={styles.help}>{ticketMerchantHint(selectedTicket.status)}</p>
            )}
            <p className={styles.help}>
              Category: {ticketCategoryLabel(selectedTicket.category)} · Shop diagnostics were
              attached when you created this ticket.
            </p>
            <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
              {(selectedTicket.messages || []).map((message) => (
                <div key={message.id}>
                  <p className={styles.sectionLabel}>
                    {message.author === 'staff' ? 'Support' : 'You'}
                    {message.created_at ? ` · ${formatTicketTime(message.created_at)}` : ''}
                  </p>
                  <p className={styles.adminRowBody} style={{ whiteSpace: 'pre-wrap' }}>
                    {message.body}
                  </p>
                </div>
              ))}
            </div>
            {selectedTicket.status !== 'closed' ? (
              <Form method="post" style={{ marginTop: 16 }}>
                <input type="hidden" name="intent" value="reply" />
                <input type="hidden" name="public_id" value={selectedTicket.public_id} />
                <input type="hidden" name="body" value={replyBody} />
                <TextField
                  label="Add a reply"
                  value={replyBody}
                  onChange={setReplyBody}
                  multiline={3}
                  autoComplete="off"
                  maxLength={8000}
                />
                <div style={{ marginTop: 12 }}>
                  <Button submit loading={replying} disabled={replying || !replyBody.trim()}>
                    {replying ? 'Sending…' : 'Send reply'}
                  </Button>
                </div>
              </Form>
            ) : null}
            {selectedId ? (
              <p className={styles.help} style={{ marginTop: 12 }}>
                <Link to={helpHref({ view: 'all' })}>Back to all tickets</Link>
              </p>
            ) : null}
          </div>
        ) : null}
        </div>
      ) : null}

      <p className={styles.help} style={{ marginTop: 24 }}>
        <Link to={withCurrentEmbeddedSearch(searchParams, '/app/setup')}>Store setup</Link>
        {' · '}
        <Link to={withCurrentEmbeddedSearch(searchParams, '/app/settings')}>Settings</Link>
        {' · '}
        Uninstalled or before install: use the public Contact page or the App Store listing.
      </p>
    </ClassicAdminShell>
  );
}
