/** Five-step Classic Light create wizard (mockup V25). Kept in its own module so create
 * does not depend on the shared Smart Pricing helpers chunk (analytics / inbox). */

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
