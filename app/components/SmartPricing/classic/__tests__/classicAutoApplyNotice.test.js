// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const SHOP = 'demo.myshopify.com';

// Polaris reads matchMedia while its modules evaluate, and jsdom has no media
// query engine, so this has to exist before anything imports it.
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

vi.mock('../../../../hooks/useClassicShopDomain', () => ({ default: () => SHOP }));

vi.mock('../../../../services/smartPricingApi', () => ({
  saveSmartPricingGuardrails: vi.fn(async () => ({ guardrails: {} })),
}));

let container;
let root;
let ClassicRolloutReadinessPanel;
let PolarisAppProvider;
let saveSmartPricingGuardrails;

beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  ({ saveSmartPricingGuardrails } = await import('../../../../services/smartPricingApi'));
  saveSmartPricingGuardrails.mockClear();
  saveSmartPricingGuardrails.mockResolvedValue({ guardrails: {} });
  ({ AppProvider: PolarisAppProvider } = await import('@shopify/polaris'));
  ({ default: ClassicRolloutReadinessPanel } = await import(
    '../details/ClassicRolloutReadinessPanel'
  ));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

/**
 * One product mid-flight, with an automatic write already scheduled. That date
 * is what makes the panel announce unattended catalog writes.
 */
function rowWithAutoApply(applyAt = '2026-10-01T00:00:00.000Z') {
  return {
    planId: 'p1',
    testId: 't1',
    title: 'Shirt',
    decision: {
      state: 'ready_challenger',
      auto: { apply_at: applyAt },
      winner: { label: 'A', price: 54, current_price: 59, price_change_percent: -8.5 },
      progress: {},
    },
  };
}

async function render(rows) {
  await act(async () => {
    root.render(
      h(PolarisAppProvider, { i18n: {} }, h(ClassicRolloutReadinessPanel, { rows }))
    );
  });
}

function buttonLabelled(label) {
  return [...container.querySelectorAll('button')].find(el => el.textContent.trim() === label);
}

const TURN_OFF = 'Turn off automatic price writes';

describe('automatic price writes notice', () => {
  it('offers the switch beside the warning it belongs to', async () => {
    await render([rowWithAutoApply()]);

    expect(container.textContent).toContain('Automatic price writes are on');
    // Settings holds two stat settings and nothing else, so announcing an
    // unattended catalog write without this button would strand the merchant.
    expect(buttonLabelled(TURN_OFF)).toBeTruthy();
  });

  it('turns them off with a patch that names only that field', async () => {
    await render([rowWithAutoApply()]);

    await act(async () => {
      buttonLabelled(TURN_OFF).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    // A full guardrail body would rewrite settings this page never showed.
    expect(saveSmartPricingGuardrails).toHaveBeenCalledWith(SHOP, {
      auto_apply_winner: false,
    });
    expect(container.textContent).toContain('Automatic price writes are off');
    expect(buttonLabelled(TURN_OFF)).toBeFalsy();
  });

  it('keeps the switch when the save fails, and says why', async () => {
    saveSmartPricingGuardrails.mockRejectedValueOnce(new Error('Network down'));
    await render([rowWithAutoApply()]);

    await act(async () => {
      buttonLabelled(TURN_OFF).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    // Reporting success here would be the worst outcome: the merchant walks
    // away believing no price will be written, and one is.
    expect(container.textContent).toContain('Network down');
    expect(container.textContent).toContain('Automatic price writes are on');
    expect(buttonLabelled(TURN_OFF)).toBeTruthy();
  });

  it('says nothing when no automatic write is scheduled', async () => {
    const row = rowWithAutoApply();
    row.decision.auto = {};
    await render([row]);

    expect(container.textContent).not.toContain('Automatic price writes');
    expect(buttonLabelled(TURN_OFF)).toBeFalsy();
  });
});
