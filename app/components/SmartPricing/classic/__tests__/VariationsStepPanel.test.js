import {
  buildNextVariation,
  createDefaultVariations,
  nextChallengerLetter,
} from '../variationsStepHelpers';

describe('VariationsStepPanel naming', () => {
  it('defaults to Control + Variation A', () => {
    const rows = createDefaultVariations();
    expect(rows.map(row => row.name)).toEqual(['Control', 'Variation A']);
    expect(rows[1].letter).toBe('A');
    expect(rows[1].id).toBe('var_a');
  });

  it('assigns Variation B after Variation A (not C)', () => {
    const rows = createDefaultVariations();
    expect(nextChallengerLetter(rows)).toBe('B');
    expect(buildNextVariation(rows)).toMatchObject({
      id: 'var_b',
      letter: 'B',
      name: 'Variation B',
      role: 'Variation B',
    });
    const withB = [...rows, buildNextVariation(rows)];
    expect(nextChallengerLetter(withB)).toBe('C');
    expect(buildNextVariation(withB).name).toBe('Variation C');
  });
});
