/** Five-step Classic Light create wizard (mockup V25). Kept in its own module so create
 * does not depend on the shared Smart Pricing helpers chunk (analytics / inbox). */

import { isOfferExperimentType } from './offerSelection';

export function getClassicCreateSteps(experimentType = 'price_test') {
  const isOffer = isOfferExperimentType(experimentType);
  return CLASSIC_CREATE_STEPS.map(step => {
    if (step.id === 'variations') {
      return {
        ...step,
        description: isOffer
          ? 'Each variation applies its offer to every selected product. Traffic must total 100%.'
          : step.description,
      };
    }
    if (step.id === 'products') {
      return {
        ...step,
        subtitle: isOffer ? 'Pick & offer' : 'Pick & price',
        title: isOffer ? 'Choose products & offers' : step.title,
        description: isOffer
          ? 'Pick which products are part of this experiment and set an offer per variation.'
          : step.description,
      };
    }
    return step;
  });
}

export function classicCreateStepIndex(stepId) {
  const key = String(stepId || '')
    .trim()
    .toLowerCase();
  if (!key) return null;
  const index = CLASSIC_CREATE_STEPS.findIndex(step => step.id === key);
  return index >= 0 ? index : null;
}

export const CLASSIC_CREATE_STEPS = [
  {
    id: 'setup',
    label: 'Basics',
    subtitle: 'Name & type',
    title: 'Set up your experiment',
    description: 'Give it a clear name, describe what you expect, and pick a type.',
  },
  {
    id: 'variations',
    label: 'Variations',
    subtitle: 'Traffic split',
    title: 'Build your variations',
    description:
      'Each variation applies its price change to every selected product. Traffic must total 100%.',
  },
  {
    id: 'products',
    label: 'Products',
    subtitle: 'Pick & price',
    title: 'Choose products & pricing',
    description: 'Pick which products are part of this experiment and set their test prices.',
  },
  {
    id: 'audience',
    label: 'Audience',
    subtitle: 'Choose Audience',
    title: 'Audience & success',
    description:
      "Decide who sees the experiment, how you'll measure success, and what must not break.",
  },
  {
    id: 'review',
    label: 'Review',
    subtitle: 'Launch',
    title: 'Review & launch',
    description: 'A quick summary before your experiment goes live.',
  },
];
