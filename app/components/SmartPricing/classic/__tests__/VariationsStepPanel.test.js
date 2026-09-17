import {
  buildNextVariation,
  createDefaultVariations,
  getVariationsStepContinueState,
  nextChallengerLetter,
  setVariationTraffic,
  sliderFillPercent,
  splitEvenly,
  trafficRemaining,
  variationTrafficHeadroom,
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

describe('variation traffic split', () => {
  it('opens on an even split between control and the first variation', () => {
    // Opening at 100/0 meant the step opened blocked, on a split the merchant
    // had not touched yet: 0% on Variation A is a starved arm.
    const rows = createDefaultVariations();
    expect(rows.map(row => row.traffic)).toEqual([50, 50]);
    expect(trafficRemaining(rows)).toBe(0);
  });

  it('changes only the row that was edited', () => {
    // This used to rescale the others proportionally, so nudging control
    // silently rewrote a challenger the merchant had just typed.
    const rows = [
      { id: 'control', traffic: 60 },
      { id: 'var_a', traffic: 25 },
      { id: 'var_b', traffic: 15 },
    ];
    const next = setVariationTraffic(rows, 0, 50);
    expect(next.map(row => row.traffic)).toEqual([50, 25, 15]);
  });

  it('caps a row at what the other rows leave free', () => {
    const rows = [
      { id: 'control', traffic: 70 },
      { id: 'var_a', traffic: 10 },
    ];
    // 20 is free, so 80 cannot be taken.
    expect(setVariationTraffic(rows, 1, 80).map(row => row.traffic)).toEqual([70, 30]);
    expect(setVariationTraffic(rows, 1, 15).map(row => row.traffic)).toEqual([70, 15]);
  });

  it('never lets an edit push the split over 100', () => {
    const rows = createDefaultVariations();
    // The even split leaves nothing free, so raising one arm needs the other
    // reduced first -- capping rather than silently rescaling its neighbour.
    expect(variationTrafficHeadroom(rows, 1)).toBe(50);
    expect(setVariationTraffic(rows, 1, 80).map(row => row.traffic)).toEqual([50, 50]);

    const freed = setVariationTraffic(rows, 0, 40);
    expect(variationTrafficHeadroom(freed, 1)).toBe(60);
    expect(setVariationTraffic(freed, 1, 60).map(row => row.traffic)).toEqual([40, 60]);
  });

  it('refuses a negative or unparseable share', () => {
    const rows = [
      { id: 'control', traffic: 50 },
      { id: 'var_a', traffic: 50 },
    ];
    expect(setVariationTraffic(rows, 1, -10)[1].traffic).toBe(0);
    expect(setVariationTraffic(rows, 1, 'abc')[1].traffic).toBe(0);
    expect(setVariationTraffic(rows, 1, 33.6)[1].traffic).toBe(33.6);
  });

  it('puts an even split back in one call', () => {
    const rows = splitEvenly([
      { id: 'control', traffic: 90 },
      { id: 'var_a', traffic: 10 },
    ]);
    expect(rows.map(row => row.traffic)).toEqual([50, 50]);
    expect(trafficRemaining(rows)).toBe(0);
  });

  it('divides three arms as evenly as 100 allows', () => {
    const rows = splitEvenly([{ id: 'control' }, { id: 'var_a' }, { id: 'var_b' }]);
    expect(rows.map(row => row.traffic)).toEqual([33.4, 33.3, 33.3]);
    expect(trafficRemaining(rows)).toBe(0);
  });
});

describe('sliderFillPercent', () => {
  it('measures the thumb against the range, not against 100', () => {
    // The painted fill has to line up with the thumb. On a 5–100 slider the
    // thumb at 5 is hard left, but the old `${value}%` painted 5% of the track,
    // so the fill ran ahead of the thumb everywhere below the midpoint.
    expect(sliderFillPercent(5, 5, 100)).toBe(0);
    expect(sliderFillPercent(100, 5, 100)).toBe(100);
    expect(sliderFillPercent(52.5, 5, 100)).toBeCloseTo(50);
  });

  it('is the plain percentage on a full-width track', () => {
    expect(sliderFillPercent(0, 0, 100)).toBe(0);
    expect(sliderFillPercent(30, 0, 100)).toBe(30);
    expect(sliderFillPercent(100, 0, 100)).toBe(100);
  });

  it('stays on the track for values outside the range', () => {
    expect(sliderFillPercent(-20, 0, 100)).toBe(0);
    expect(sliderFillPercent(180, 0, 100)).toBe(100);
    // A zero-width range has no position to report rather than dividing by zero.
    expect(sliderFillPercent(50, 40, 40)).toBe(0);
  });
});

describe('getVariationsStepContinueState', () => {
  it('lets the default split through, since both arms already have a share', () => {
    const gate = getVariationsStepContinueState({ variations: createDefaultVariations() });
    expect(gate).toEqual({ disabled: false, reason: '', hint: '' });
  });

  it('still blocks an arm left on nothing', () => {
    const gate = getVariationsStepContinueState({
      variations: [
        { id: 'control', name: 'Control', traffic: 100 },
        { id: 'var_a', name: 'Variation A', traffic: 0 },
      ],
    });
    expect(gate.disabled).toBe(true);
    expect(gate.reason).toBe('zero_traffic_arm');
    expect(gate.hint).toMatch(/Variation A would get no traffic/i);
  });

  it('names how much is still unassigned', () => {
    const gate = getVariationsStepContinueState({
      variations: [
        { id: 'control', name: 'Control', traffic: 40 },
        { id: 'var_a', name: 'Variation A', traffic: 25 },
      ],
    });
    expect(gate.disabled).toBe(true);
    expect(gate.reason).toBe('under_allocated');
    expect(gate.hint).toMatch(/35\.0% of traffic is unassigned/i);
  });

  it('recovers a draft saved over 100 before the cap existed', () => {
    const gate = getVariationsStepContinueState({
      variations: [
        { id: 'control', name: 'Control', traffic: 80 },
        { id: 'var_a', name: 'Variation A', traffic: 60 },
      ],
    });
    expect(gate.disabled).toBe(true);
    expect(gate.reason).toBe('over_allocated');
    expect(gate.hint).toMatch(/140\.0%/);
    expect(gate.hint).toMatch(/40\.0%/);
  });

  it('lists the shape of the problem when several arms are starved', () => {
    const gate = getVariationsStepContinueState({
      variations: [
        { id: 'control', name: 'Control', traffic: 100 },
        { id: 'var_a', name: 'Variation A', traffic: 0 },
        { id: 'var_b', name: 'Variation B', traffic: 0 },
      ],
    });
    expect(gate.disabled).toBe(true);
    expect(gate.hint).toMatch(/Every variation needs a share/i);
  });

  it('needs something to compare against', () => {
    const gate = getVariationsStepContinueState({
      variations: [{ id: 'control', name: 'Control', traffic: 100 }],
    });
    expect(gate.disabled).toBe(true);
    expect(gate.reason).toBe('too_few_arms');
  });

  it('clears once the split is complete and every arm has a share', () => {
    const gate = getVariationsStepContinueState({
      variations: [
        { id: 'control', name: 'Control', traffic: 70 },
        { id: 'var_a', name: 'Variation A', traffic: 30 },
      ],
    });
    expect(gate).toEqual({ disabled: false, reason: '', hint: '' });
  });
});
