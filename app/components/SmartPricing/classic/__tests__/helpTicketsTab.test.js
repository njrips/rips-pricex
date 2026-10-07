// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  countTicketsByFilter,
  filterTickets,
  formatTicketRelativeTime,
  shouldAutoOpenAttention,
  ticketLastMessageLine,
} from '../helpFaq';

if (!window.matchMedia) {
  window.matchMedia = query => ({
    media: query,
    matches: false,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => false,
  });
}

const TICKETS = [
  {
    public_id: 'PX-AAAA',
    subject: 'Prices not showing on product page',
    category: 'live',
    status: 'waiting_staff',
    updated_at: '2026-10-06T10:00:00Z',
    last_message_preview: 'Still blank after refresh',
    last_message_author: 'merchant',
  },
  {
    public_id: 'PX-BBBB',
    subject: 'Plan question',
    category: 'billing',
    status: 'waiting_merchant',
    updated_at: '2026-10-05T10:00:00Z',
    last_message_preview: 'Which plan are you on?',
    last_message_author: 'staff',
  },
  {
    public_id: 'PX-CCCC',
    subject: 'Checkout setup',
    category: 'setup',
    status: 'resolved',
    updated_at: '2026-09-01T10:00:00Z',
  },
];

describe('ticket table helpers', () => {
  it('counts tickets by who acts next', () => {
    expect(countTicketsByFilter(TICKETS)).toEqual({
      all: 3,
      needs_reply: 1,
      with_support: 1,
      done: 1,
    });
  });

  it('puts tickets needing a reply first and filters by view', () => {
    expect(filterTickets(TICKETS).map(t => t.public_id)).toEqual(['PX-BBBB', 'PX-AAAA', 'PX-CCCC']);
    expect(filterTickets(TICKETS, { filter: 'done' }).map(t => t.public_id)).toEqual(['PX-CCCC']);
    expect(filterTickets(TICKETS, { filter: 'nonsense' })).toHaveLength(3);
  });

  it('searches id, subject, category and the last message', () => {
    expect(filterTickets(TICKETS, { query: 'px-cccc' })).toHaveLength(1);
    expect(filterTickets(TICKETS, { query: 'billing' })[0].public_id).toBe('PX-BBBB');
    expect(filterTickets(TICKETS, { query: 'refresh' })[0].public_id).toBe('PX-AAAA');
  });

  it('formats update times relative to now', () => {
    const now = Date.parse('2026-10-06T12:00:00Z');
    expect(formatTicketRelativeTime('2026-10-06T11:59:40Z', now)).toBe('Just now');
    expect(formatTicketRelativeTime('2026-10-06T11:45:00Z', now)).toBe('15 min ago');
    expect(formatTicketRelativeTime('2026-10-06T09:00:00Z', now)).toBe('3 h ago');
    expect(formatTicketRelativeTime('2026-10-05T06:00:00Z', now)).toBe('Yesterday');
    expect(formatTicketRelativeTime('', now)).toBe('');
  });

  it('labels who wrote the last message', () => {
    expect(ticketLastMessageLine(TICKETS[1])).toBe('Support: Which plan are you on?');
    expect(ticketLastMessageLine(TICKETS[2])).toBe('');
  });

  it('does not jump to a waiting ticket while composing a new one', () => {
    expect(shouldAutoOpenAttention({})).toBe(true);
    expect(shouldAutoOpenAttention({ compose: '1' })).toBe(false);
  });
});

let container;
let root;
let ClassicHelpPage;
let PolarisAppProvider;
let createMemoryRouter;
let RouterProvider;

beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  // Opening a ticket scrolls it into view; jsdom has no layout to scroll.
  Element.prototype.scrollIntoView = () => {};
  ({ AppProvider: PolarisAppProvider } = await import('@shopify/polaris'));
  ({ createMemoryRouter, RouterProvider } = await import('react-router'));
  ({ default: ClassicHelpPage } = await import('../ClassicHelpPage'));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function render(props, url = '/app/help?tab=tickets') {
  const router = createMemoryRouter(
    [{ path: '/app/help', element: h(ClassicHelpPage, props) }],
    { initialEntries: [url] }
  );
  await act(async () => {
    root.render(h(PolarisAppProvider, { i18n: {} }, h(RouterProvider, { router })));
  });
  return router;
}

function rows() {
  return [...container.querySelectorAll('tbody tr')];
}

function button(text) {
  return [...container.querySelectorAll('button')].find(node =>
    node.textContent.trim().startsWith(text)
  );
}

describe('Support tickets tab', () => {
  it('lists tickets in a table with one row per ticket', async () => {
    await render({ tickets: TICKETS });
    const headers = [...container.querySelectorAll('thead th')].map(th => th.textContent);
    expect(headers).toEqual(['Ticket', 'Subject', 'Category', 'Status', 'Updated']);
    expect(rows()).toHaveLength(3);
    expect(rows()[0].textContent).toContain('PX-BBBB');
    expect(rows()[0].textContent).toContain('Waiting on you');
    expect(rows()[0].textContent).toContain('Support: Which plan are you on?');
  });

  it('keeps the table simple when there are only a few tickets', async () => {
    await render({ tickets: TICKETS });
    expect(container.querySelector('[aria-label="Filter tickets"]')).toBeNull();
    expect(container.querySelector('input[placeholder^="Search"]')).toBeNull();
  });

  it('tells you when our team is waiting on you, right above the table', async () => {
    await render({ tickets: TICKETS });
    expect(container.textContent).toContain('Our team replied and is waiting on you.');
    expect(container.textContent).toContain('Open PX-BBBB');
  });

  it('filters the table by view once there are enough tickets', async () => {
    const many = [
      ...TICKETS,
      ...['DDDD', 'EEEE', 'FFFF'].map(id => ({
        public_id: `PX-${id}`,
        subject: `Other ${id}`,
        category: 'other',
        status: 'resolved',
        updated_at: '2026-08-01T10:00:00Z',
      })),
    ];
    await render({ tickets: many });
    expect(container.querySelector('[aria-label="Filter tickets"]')).not.toBeNull();
    await act(async () => button('Needs your reply').click());
    expect(rows()).toHaveLength(1);
    expect(rows()[0].textContent).toContain('PX-BBBB');
    await act(async () => button('Resolved').click());
    expect(rows()).toHaveLength(4);
  });

  it('shows a failed ticket submit next to the form, not at the top of the page', async () => {
    await render({ tickets: [], formError: 'Too many tickets today' }, '/app/help?tab=tickets');
    const form = container.querySelector('#help-new-ticket');
    expect(form.textContent).toContain('Your ticket was not sent');
    expect(form.textContent).toContain('Too many tickets today');
  });

  it('sends a reply with Cmd/Ctrl + Enter', async () => {
    await render(
      {
        tickets: TICKETS,
        selectedTicket: { ...TICKETS[1], messages: [] },
      },
      '/app/help?ticket=PX-BBBB'
    );
    const form = container.querySelector('form');
    let submitted = 0;
    form.requestSubmit = () => {
      submitted += 1;
    };
    const textarea = form.querySelector('textarea');
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    await act(async () => {
      setValue.call(textarea, 'Thanks, it works now');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      textarea.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true })
      );
    });
    expect(submitted).toBe(1);
  });

  it('opens the ticket when a row is clicked', async () => {
    const router = await render({ tickets: TICKETS });
    await act(async () => rows()[1].querySelector('td:nth-child(3)').click());
    expect(router.state.location.search).toContain('ticket=PX-AAAA');
  });

  it('opens the new-ticket form from the toolbar', async () => {
    const router = await render({ tickets: TICKETS });
    await act(async () => button('New ticket').click());
    expect(router.state.location.search).toContain('compose=1');
    expect(container.querySelector('#help-new-ticket')).not.toBeNull();
    expect(container.textContent).toContain('Attached automatically');
  });

  it('shows the form straight away when there are no tickets', async () => {
    await render({ tickets: [] });
    expect(container.querySelector('#help-new-ticket')).not.toBeNull();
    expect(container.querySelector('table')).toBeNull();
  });

  it('shows one ticket as a conversation with a reply box', async () => {
    await render(
      {
        tickets: TICKETS,
        selectedTicket: {
          ...TICKETS[1],
          messages: [
            { id: 1, author: 'merchant', body: 'How do plans work?' },
            { id: 2, author: 'staff', body: 'Which plan are you on?' },
          ],
        },
      },
      '/app/help?ticket=PX-BBBB'
    );
    const messages = [...container.querySelectorAll('ol[aria-label="Conversation"] li')];
    expect(messages.map(li => li.textContent)).toEqual([
      expect.stringContaining('How do plans work?'),
      expect.stringContaining('Which plan are you on?'),
    ]);
    expect(messages[1].textContent).toContain('Priceify support');
    expect(container.textContent).toContain('All tickets');
    expect(button('Send reply')).toBeTruthy();
  });
});
