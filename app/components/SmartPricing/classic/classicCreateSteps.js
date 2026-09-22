/** Five-step Classic Light create wizard (mockup V25). Kept in its own module so create
 * does not depend on the shared Smart Pricing helpers chunk (analytics / inbox). */

import { isOfferExperimentType } from './offerSelection';

export function getClassicCreateSteps(experimentType = 'price_test') {
  const isOffer = isOfferExperimentType(experimentType);
  return CLASSIC_CREATE_STEPS.map(step => {
    // Traffic step copy lives in VariationsStepPanel (PDF); no card subtitle here.
    if (step.id === 'variations') {
      return { ...step, description: '' };
    }
    if (step.id === 'products') {
      return {
        ...step,
        label: isOffer ? 'Products & offers' : step.label,
        title: isOffer ? 'Choose products & offers' : step.title,
        description: '',
      };
    }
    return step;
  });
}

export function classicCreateStepId(index) {
  const step = CLASSIC_CREATE_STEPS[Number(index)];
  return step ? step.id : null;
}

export function classicCreateStepIndex(stepId) {
  const key = String(stepId || '')
    .trim()
    .toLowerCase();
  if (!key) return null;
  const index = CLASSIC_CREATE_STEPS.findIndex(step => step.id === key);
  return index >= 0 ? index : null;
}

/** Two-line stepper labels for "Foo & bar" without changing the spec wording. */
export function stepLabelLines(label) {
  const text = String(label || '').trim();
  if (!text.includes(' & ')) return [text];
  const amp = text.indexOf(' & ');
  return [text.slice(0, amp + 3).trimEnd(), text.slice(amp + 3).trim()];
}

export const CLASSIC_CREATE_STEPS = [
  {
    id: 'setup',
    label: 'Basics',
    title: 'Set up your test',
    description: '',
  },
  {
    id: 'variations',
    label: 'Traffic',
    title: 'Traffic & variations',
    description: '',
  },
  {
    id: 'products',
    label: 'Products & prices',
    title: 'Choose products & set test prices',
    description: '',
  },
  {
    id: 'audience',
    label: 'Audience & goals',
    title: 'Audience & goals',
    description: '',
  },
  {
    id: 'review',
    label: 'Review & launch',
    title: 'Review & launch',
    description:
      'Check your settings before launching. You can pause or stop a test at any time.',
  },
];
