import { isOfferExperimentType } from './offerSelection';

const LETTERS = 'ABCDEFGH';

/**
 * Floor for experiment traffic allocation.
 *
 * Lives here rather than in either panel because both the create wizard and the
 * edit modal render this slider, and the floor has to be the same number in the
 * `min` attribute and in the fill maths -- they disagreed once already, which is
 * what painted the track past the thumb.
 */
export const MIN_ALLOCATION_PERCENT = 5;

/**
 * A new experiment opens on an even split between control and the first
 * variation.
 *
 * This used to open at 100/0 on the reasoning that an unmade decision should
 * send nobody to a test price. In practice the step opened blocked -- 0% on
 * Variation A is a starved arm, so Continue was disabled with a hint about a
 * split the merchant had not touched yet -- and the even split is what almost
 * every test wants anyway. Only this first pair is filled in: adding a third
 * variation still leaves it on 0 for the merchant to place, and nothing here
 * rebalances a split once it has been edited.
 */
export function createDefaultVariations() {
  return [
    {
      id: 'control',
      letter: null,
      role: 'Control',
      name: 'Control',
      description: 'Current price',
      traffic: 50,
    },
    {
      // Letters are reserved for challengers; Control uses a baseline symbol in the UI.
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

function rowTraffic(row) {
  const value = Number(row?.traffic);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/** What is left for one row once every other row has taken its share. */
export function variationTrafficHeadroom(variations, index) {
  const rows = Array.isArray(variations) ? variations : [];
  const others = rows.reduce((sum, row, i) => (i === index ? sum : sum + rowTraffic(row)), 0);
  return Math.max(0, 100 - others);
}

/**
 * Sets one row's share and leaves every other row alone.
 *
 * This used to rescale the other rows to keep the total at 100, which meant
 * nudging Control silently rewrote every challenger — a merchant who had just
 * typed 20 into Variation B watched it become 18 for reasons the screen never
 * explained. Editing one number now changes one number. The total is instead
 * held at or below 100 by capping each row at what the others leave free, so
 * the only state the merchant has to resolve is an under-allocated split.
 */
export function setVariationTraffic(variations, index, nextTraffic) {
  const rows = Array.isArray(variations) ? variations : [];
  const requested = Math.max(0, Math.min(100, Math.round(Number(nextTraffic) || 0)));
  const capped = Math.min(requested, variationTrafficHeadroom(rows, index));
  return rows.map((row, i) => (i === index ? { ...row, traffic: capped } : row));
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
  return (Array.isArray(variations) ? variations : []).reduce(
    (sum, row) => sum + rowTraffic(row),
    0
  );
}

/** Positive while traffic is still unassigned, negative if a draft is over. */
export function trafficRemaining(variations) {
  return 100 - trafficTotal(variations);
}

/**
 * Where the thumb sits along the track, as a percentage of the track.
 *
 * The track is painted with a gradient that has to line up with the thumb, and
 * the thumb's position is a fraction of the range rather than of 100. On a
 * slider running 5–100 that difference is the whole low end: at 5 the thumb is
 * hard left while the paint claimed 5%, so the fill sat ahead of the thumb
 * everywhere below the midpoint.
 */
export function sliderFillPercent(value, min = 0, max = 100) {
  const span = Number(max) - Number(min);
  if (!Number.isFinite(span) || span <= 0) return 0;
  const offset = (Number(value) || 0) - Number(min);
  return Math.max(0, Math.min(100, (offset / span) * 100));
}

/**
 * Whether the split is finished, and if not, what the merchant has to do.
 *
 * Returned rather than thrown at save time so Continue can be disabled with the
 * reason on screen, instead of letting the merchant press it and answering with
 * a toast after the fact.
 */
export function getVariationsStepContinueState({ variations = [] } = {}) {
  const rows = Array.isArray(variations) ? variations : [];
  if (rows.length < 2) {
    return {
      disabled: true,
      reason: 'too_few_arms',
      hint: 'An experiment needs a control and at least one variation.',
    };
  }

  const remaining = trafficRemaining(rows);
  if (remaining > 0) {
    return {
      disabled: true,
      reason: 'under_allocated',
      hint: `${remaining}% of traffic is unassigned. Give it to a variation, or use Split equally.`,
    };
  }
  // Not reachable from the controls, which cap each row at the free remainder,
  // but a draft saved before that cap existed can still restore over 100.
  if (remaining < 0) {
    return {
      disabled: true,
      reason: 'over_allocated',
      hint: `The split adds up to ${trafficTotal(rows)}%. Take ${Math.abs(remaining)}% back off a variation.`,
    };
  }

  const starved = rows.filter(row => rowTraffic(row) <= 0);
  if (starved.length) {
    const only = starved.length === 1 ? starved[0] : null;
    return {
      disabled: true,
      reason: 'zero_traffic_arm',
      hint: only
        ? `${only.name || only.role || 'One variation'} would get no traffic. Give it a share, or remove it.`
        : 'Every variation needs a share of traffic. Give each one a percentage, or remove it.',
    };
  }

  return { disabled: false, reason: '', hint: '' };
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
      letter: isControl ? null : challengerLetter,
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
