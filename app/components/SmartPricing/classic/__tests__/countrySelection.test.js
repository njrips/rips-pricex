import { describe, expect, it } from 'vitest';
import { ISO_COUNTRIES } from '../../../../utils/iso3166CountryDisplay';
import {
  collapseCountrySelection,
  formatSplitCountryAudienceLabel,
  getCountryFieldHelp,
  isAllCountriesOptionVisible,
  isAllCountriesSelected,
  isWorldwideCountrySelection,
  normalizeCountrySelection,
  resolveCountryLists,
} from '../countrySelection';

describe('countrySelection', () => {
  it('normalizes codes, names, and drops invalids plus sentinels', () => {
    expect(normalizeCountrySelection(['us', 'United Kingdom', 'XX', 'US', '*'])).toEqual([
      'US',
      'GB',
    ]);
    expect(normalizeCountrySelection('CA, de')).toEqual(['CA', 'DE']);
  });

  it('treats empty include and worldwide sentinels as All countries', () => {
    expect(isWorldwideCountrySelection([])).toBe(true);
    expect(isWorldwideCountrySelection(['*'])).toBe(true);
    expect(isWorldwideCountrySelection(['worldwide'])).toBe(true);
    expect(isAllCountriesSelected([], 'include')).toBe(true);
    expect(isAllCountriesSelected([], 'exclude')).toBe(false);
  });

  it('collapses a full ISO dump to empty in include mode only', () => {
    const all = ISO_COUNTRIES.map(row => row.code);
    expect(isWorldwideCountrySelection(all)).toBe(true);
    expect(collapseCountrySelection(all, 'include')).toEqual([]);
    expect(collapseCountrySelection(all, 'exclude')).toEqual(all);
  });

  it('shows the All option only for empty or worldwide-like queries', () => {
    expect(isAllCountriesOptionVisible('', 'include')).toBe(true);
    expect(isAllCountriesOptionVisible('world', 'include')).toBe(true);
    expect(isAllCountriesOptionVisible('all countries', 'include')).toBe(true);
    expect(isAllCountriesOptionVisible('united', 'include')).toBe(false);
    expect(isAllCountriesOptionVisible('marshall', 'include')).toBe(false);
    expect(isAllCountriesOptionVisible('wallis', 'include')).toBe(false);
    expect(isAllCountriesOptionVisible('', 'exclude')).toBe(false);
  });

  it('explains which country list applies in the field help', () => {
    expect(getCountryFieldHelp([], 'include')).toMatch(/worldwide/i);
    expect(getCountryFieldHelp([], 'exclude')).toMatch(/no countries excluded/i);
    expect(getCountryFieldHelp(['US'], 'exclude')).toMatch(/only one list applies/i);
    expect(getCountryFieldHelp(['US'], 'include')).toMatch(/only one list applies/i);
  });

  it('applies only one country list at a time', () => {
    expect(resolveCountryLists({ countries: ['US'], countryMode: 'include' })).toEqual({
      includeCountries: ['US'],
      excludeCountries: [],
      countryMode: 'include',
    });
    expect(
      resolveCountryLists({ includeCountries: [], excludeCountries: ['BD'], countryMode: 'exclude' })
    ).toEqual({ includeCountries: [], excludeCountries: ['BD'], countryMode: 'exclude' });
    expect(
      resolveCountryLists({ includeCountries: [], excludeCountries: [], countryMode: 'exclude' })
    ).toEqual({ includeCountries: [], excludeCountries: [], countryMode: 'exclude' });
  });

  it('settles an older audience holding both lists on the include list that ran', () => {
    expect(
      resolveCountryLists({
        includeCountries: ['US', 'AF'],
        excludeCountries: ['BD'],
        countryMode: 'exclude',
      })
    ).toEqual({ includeCountries: ['US', 'AF'], excludeCountries: [], countryMode: 'include' });
    expect(
      resolveCountryLists({ includeCountries: [], excludeCountries: ['BD'], countryMode: 'include' })
    ).toEqual({ includeCountries: [], excludeCountries: ['BD'], countryMode: 'exclude' });
    expect(
      formatSplitCountryAudienceLabel(
        ...Object.values(
          resolveCountryLists({ includeCountries: ['US', 'AF'], excludeCountries: ['BD'] })
        ).slice(0, 2)
      )
    ).toBe('Include: US, AF');
  });

  it('formats include and exclude together for review', () => {
    expect(formatSplitCountryAudienceLabel(['US'], [])).toBe('Include: US');
    expect(formatSplitCountryAudienceLabel([], ['GB'])).toBe('Exclude: GB');
    expect(formatSplitCountryAudienceLabel(['US', 'CA'], ['GB'])).toBe(
      'Include: US, CA · Exclude: GB'
    );
  });
});
