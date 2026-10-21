// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import CodeSnippetEditor, { parseSnippetErrorLine } from '../CodeSnippetEditor';

describe('parseSnippetErrorLine', () => {
  it('reads line numbers from javascript validation messages', () => {
    expect(parseSnippetErrorLine('Line 4: Unexpected token')).toBe(4);
    expect(parseSnippetErrorLine('CSS has unmatched braces')).toBe(null);
  });
});

describe('CodeSnippetEditor gutter', () => {
  let container;
  let root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  const render = async value => {
    await act(async () => {
      root.render(h(CodeSnippetEditor, { id: 'css', value, onChange: () => {} }));
    });
  };

  it('numbers every line and keeps long lines on one row', async () => {
    await render(Array.from({ length: 1200 }, (_, i) => `.rule-${i} {}`).join('\n'));
    const textarea = container.querySelector('textarea');
    expect(textarea.getAttribute('wrap')).toBe('off');
    const gutter = container.querySelector('[aria-hidden]');
    expect(gutter.textContent.endsWith('1200')).toBe(true);
    // Four digits need a wider gutter than the default two.
    expect(gutter.style.width).toContain('4ch');
  });

  it('moves the numbers with the textarea scroll', async () => {
    await render('a\nb\nc');
    const textarea = container.querySelector('textarea');
    const numbers = container.querySelector('[aria-hidden] > div');
    textarea.scrollTop = 36;
    await act(async () => {
      textarea.dispatchEvent(new Event('scroll'));
    });
    expect(numbers.style.transform).toBe(`translateY(${-textarea.scrollTop}px)`);
  });
});
