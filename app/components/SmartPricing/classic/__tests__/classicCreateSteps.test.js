import { describe, expect, it } from 'vitest';
import { stepLabelLines } from '../classicCreateSteps';

describe('stepLabelLines', () => {
  it('keeps single-word labels on one line', () => {
    expect(stepLabelLines('Basics')).toEqual(['Basics']);
    expect(stepLabelLines('Traffic')).toEqual(['Traffic']);
  });

  it('splits ampersand labels for the stepper column', () => {
    expect(stepLabelLines('Products & prices')).toEqual(['Products &', 'prices']);
    expect(stepLabelLines('Audience & goals')).toEqual(['Audience &', 'goals']);
    expect(stepLabelLines('Review & launch')).toEqual(['Review &', 'launch']);
    expect(stepLabelLines('Products & offers')).toEqual(['Products &', 'offers']);
  });
});
