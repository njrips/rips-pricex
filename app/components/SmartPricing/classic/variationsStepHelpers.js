import { isOfferExperimentType } from './offerSelection';

const LETTERS = 'ABCDEFGH';

export function createDefaultVariations() {
  return [
    {
      id: 'control',
      letter: 'A',
      role: 'Control',
      name: 'Control',
      description: 'Current price',
      traffic: 50,
    },
    {
      // First challenger is Variation A. Control keeps badge "A" as the control marker.
      id: 'var_a',
      letter: 'A',
      role: 'Variation A',
      name: 'Variation A',
      description: '',
      traffic: 50,
    },
  ];
}

/** Next challenger letter after Control + existing variations (A, then B, then C…). */
export function nextChallengerLetter(variations = []) {
  const challengerCount = (Array.isArray(variations) ? variations : []).filter((row, index) => {
    if (index === 0) return false;
    const id = String(row?.id || '')
      .trim()
      .toLowerCase();
    const role = String(row?.role || '')
      .trim()
      .toLowerCase();
    return id !== 'control' && role !== 'control';
  }).length;
  return LETTERS[challengerCount] || String(challengerCount + 1);
}

export function normalizeTraffic(variations, index, nextTraffic) {
  const clamped = Math.max(0, Math.min(100, Number(nextTraffic) || 0));
  const others = variations.filter((_, i) => i !== index);
  const remaining = Math.max(0, 100 - clamped);
  const otherSum = others.reduce((sum, row) => sum + (Number(row.traffic) || 0), 0) || 1;
  return variations.map((row, i) => {
    if (i === index) return { ...row, traffic: clamped };
    const share = ((Number(row.traffic) || 0) / otherSum) * remaining;
    return { ...row, traffic: Math.round(share) };
  });
}

export function splitEvenly(variations) {
  const n = variations.length || 1;
  const base = Math.floor(100 / n);
  let rem = 100 - base * n;
  return variations.map(row => {
    const traffic = base + (rem > 0 ? 1 : 0);
    if (rem > 0) rem -= 1;
    return { ...row, traffic };
  });
}

export function trafficTotal(variations) {
  return variations.reduce((sum, row) => sum + (Number(row.traffic) || 0), 0);
}

export function variationsFromPlanArms(arms = [], experimentType = 'price_test') {
  const isOffer = isOfferExperimentType(experimentType);
  return (Array.isArray(arms) ? arms : []).map((arm, index) => {
    const isControl =
      index === 0 ||
      arm?.role === 'control' ||
      String(arm?.id || '').toLowerCase() === 'control';
    const challengerLetter = String.fromCharCode(64 + Math.max(1, index));
    return {
      id: arm?.id || (isControl ? 'control' : `var_${challengerLetter.toLowerCase()}`),
      letter: isControl ? 'A' : challengerLetter,
      role: isControl ? 'Control' : `Variation ${challengerLetter}`,
      name: arm?.label || (isControl ? 'Control' : `Variation ${challengerLetter}`),
      description: isControl ? (isOffer ? 'No offer (baseline)' : 'Current price') : '',
      traffic: Number(arm?.allocation_percent ?? arm?.traffic_percent ?? arm?.traffic) || 0,
    };
  });
}

export function buildNextVariation(variations = []) {
  const letter = nextChallengerLetter(variations);
  return {
    id: `var_${letter.toLowerCase()}`,
    letter,
    role: `Variation ${letter}`,
    name: `Variation ${letter}`,
    description: '',
    traffic: 0,
  };
}
