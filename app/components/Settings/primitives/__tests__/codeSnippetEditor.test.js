// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { parseSnippetErrorLine } from '../CodeSnippetEditor';

describe('parseSnippetErrorLine', () => {
  it('reads line numbers from javascript validation messages', () => {
    expect(parseSnippetErrorLine('Line 4: Unexpected token')).toBe(4);
    expect(parseSnippetErrorLine('CSS has unmatched braces')).toBe(null);
  });
});
