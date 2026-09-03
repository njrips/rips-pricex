import {
  buildNextVariation,
  createDefaultVariations,
  nextChallengerLetter,
  variationsFromPlanArms,
} from '../variationsStepHelpers';

describe('VariationsStepPanel naming', () => {
  it('defaults to Control + Variation A', () => {
    const rows = createDefaultVariations();
    expect(rows.map(row => row.name)).toEqual(['Control', 'Variation A']);
    expect(rows[0].letter).toBeNull();
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

  it('keeps letters exclusive to challenger variations when restoring a plan', () => {
    const rows = variationsFromPlanArms([
      { id: 'control', role: 'control', allocation_percent: 50 },
      { id: 'challenger', role: 'challenger', allocation_percent: 50 },
    ]);

    expect(rows.map(row => row.letter)).toEqual([null, 'A']);
    expect(rows.map(row => row.role)).toEqual(['Control', 'Variation A']);
  });
});
