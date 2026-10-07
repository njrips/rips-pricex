import { useEffect, useState } from 'react';
import { Link, useNavigation, useRevalidator, useSearchParams } from 'react-router';
import { Banner, Button, TextField } from '@shopify/polaris';
import LabelWithInfo from '../../Settings/primitives/LabelWithInfo';
import SettingsGuideBody from '../../Settings/SettingsGuideBody';
import { searchDocsNavTopics, searchDocsSections } from '../../public/priceify/docsContent';
import { openPublicDocsHref, publicDocsHref } from '../../Settings/settingsGuideLinks';
import ClassicAdminShell from './ClassicAdminShell';
import HelpTicketsTab from './HelpTicketsTab';
import {
  HELP_FAQ_ITEMS,
  HELP_GLOSSARY_TERMS,
  HELP_TABS,
  attentionTicketToPrompt,
  countTicketsAwaitingMerchant,
  filterHelpFaq,
  resolveHelpTab,
} from './helpFaq';
import { withCurrentEmbeddedSearch } from '../../../utils/shopifyEmbeddedSearch';
import styles from './SmartPricingClassic.module.css';

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
  // Errors come back without saying which form failed, so remember the last one sent.
  const pendingIntent = submitting ? String(navigation.formData?.get('intent') || '') : '';
  const [submittedIntent, setSubmittedIntent] = useState('');
  if (pendingIntent && pendingIntent !== submittedIntent) {
    setSubmittedIntent(pendingIntent);
  }
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
  const [draft, setDraft] = useState(() => ({
    category: 'setup',
    subject: '',
    body: '',
    replyEmail: staffEmail || '',
  }));
  const [replyBody, setReplyBody] = useState('');
  const [ticketFilter, setTicketFilter] = useState('all');
  const [ticketQuery, setTicketQuery] = useState('');
  // Drafts outlive tab switches, but not the submit that turned them into a
  // ticket or a message. Each success is cleared once, keyed by what it produced.
  const createdKey = searchParams.get('created') === '1' ? selectedId : '';
  const sentKey =
    searchParams.get('sent') === '1'
      ? `${selectedId}:${(selectedTicket?.messages || []).length}`
      : '';
  const [clearedKeys, setClearedKeys] = useState({ created: '', sent: '' });
  if (createdKey && clearedKeys.created !== createdKey) {
    setClearedKeys(prev => ({ ...prev, created: createdKey }));
    setDraft(prev => ({ ...prev, subject: '', body: '' }));
  }
  if (sentKey && clearedKeys.sent !== sentKey) {
    setClearedKeys(prev => ({ ...prev, sent: sentKey }));
    setReplyBody('');
  }

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

  const selectTab = (nextTab, { compose = false } = {}) => {
    const params = new URLSearchParams(searchParams);
    if (nextTab === 'answers') {
      params.delete('tab');
      // Leave the open ticket behind, or it would pull the tab straight back.
      params.delete('ticket');
      params.set('view', 'all');
    } else {
      params.set('tab', 'tickets');
      if (compose) {
        params.delete('ticket');
        params.set('compose', '1');
      }
    }
    setSearchParams(params, { replace: true });
  };

  return (
    <ClassicAdminShell
      titleBar="Help & docs"
      meta="Support"
      title="Help & docs"
      subtitle="Find an answer, or ask our team. Tickets include your shop details automatically."
      tabs={HELP_TABS.map(item =>
        item.id === 'tickets' && awaitingMerchant > 0
          ? { ...item, label: `${item.label} (${awaitingMerchant})` }
          : item
      )}
      activeTab={tab}
      onTabChange={selectTab}
      tabsLabel="Help sections"
    >
      {listError && tab === 'tickets' ? (
        <div style={{ marginBottom: 16 }}>
          <Banner tone="warning" title={listError} />
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
      {attentionId && tab === 'answers' ? (
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
            <Button variant="plain" onClick={() => selectTab('tickets', { compose: true })}>
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
        <HelpTicketsTab
          tickets={tickets}
          selectedTicket={selectedTicket}
          selectedId={selectedId}
          compose={searchParams.get('compose') === '1'}
          helpHref={helpHref}
          draft={draft}
          onDraftChange={setDraft}
          creating={creating}
          replyBody={replyBody}
          onReplyChange={setReplyBody}
          replying={replying}
          filter={ticketFilter}
          onFilterChange={setTicketFilter}
          query={ticketQuery}
          onQueryChange={setTicketQuery}
          formError={formError}
          formIntent={submittedIntent}
        />
      ) : null}

      {tab === 'answers' ? (
        <p className={styles.help} style={{ marginTop: 24 }}>
          <Link to={withCurrentEmbeddedSearch(searchParams, '/app/setup')}>Store setup</Link>
          {' · '}
          <Link to={withCurrentEmbeddedSearch(searchParams, '/app/settings')}>Settings</Link>
          {' · '}
          Uninstalled or before install: use the public Contact page or the App Store listing.
        </p>
      ) : null}
    </ClassicAdminShell>
  );
}
