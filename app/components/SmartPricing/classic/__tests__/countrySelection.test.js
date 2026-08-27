import { describe, expect, it } from 'vitest';
import { ISO_COUNTRIES } from '../../../../utils/iso3166CountryDisplay';
import {
  ALL_COUNTRIES_LABEL,
  NONE_EXCLUDED_LABEL,
  collapseCountrySelection,
  formatCountryAudienceLabel,
  formatCountryAudienceValue,
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

  it('formats review and field copy without listing every country', () => {
    expect(formatCountryAudienceLabel([], 'include')).toBe(ALL_COUNTRIES_LABEL);
    expect(formatCountryAudienceLabel([], 'exclude')).toBe(NONE_EXCLUDED_LABEL);
    expect(formatCountryAudienceLabel(['US'], 'include')).toBe('Include: US');
    expect(formatCountryAudienceValue(['US', 'CA'], 'exclude')).toBe('Exclude: US, CA');
    expect(formatCountryAudienceValue(['United States', 'Canada', 'DE', 'FR'], 'include')).toBe(
      'US, CA, DE, FR'
    );
    expect(
      formatCountryAudienceValue(['US', 'CA', 'DE', 'FR', 'JP', 'AU', 'NZ', 'IN', 'BR'], 'include')
    ).toBe('US, CA, DE, FR, JP, AU, NZ, IN + 1 more');
    expect(getCountryFieldHelp([], 'include')).toMatch(/worldwide/i);
    expect(getCountryFieldHelp([], 'exclude')).toMatch(/no countries excluded/i);
    expect(getCountryFieldHelp(['US'], 'exclude', ['CA'])).toMatch(/other tab/i);
  });

  it('keeps include and exclude lists independent when switching tabs', () => {
    expect(resolveCountryLists({ countries: ['US'], countryMode: 'include' })).toEqual({
      includeCountries: ['US'],
      excludeCountries: [],
      countryMode: 'include',
    });
    expect(
      resolveCountryLists({
        includeCountries: ['US'],
        excludeCountries: [],
        countries: ['US'],
        countryMode: 'exclude',
      })
    ).toEqual({
      includeCountries: ['US'],
      excludeCountries: [],
      countryMode: 'exclude',
    });
    expect(
      resolveCountryLists({
        includeCountries: ['US'],
        excludeCountries: ['GB', 'US'],
        countryMode: 'exclude',
      })
    ).toEqual({
      includeCountries: ['US'],
      excludeCountries: ['GB'],
      countryMode: 'exclude',
    });
  });

  it('formats include and exclude together for review', () => {
    expect(formatSplitCountryAudienceLabel(['US'], [])).toBe('Include: US');
    expect(formatSplitCountryAudienceLabel([], ['GB'])).toBe('All countries · Exclude: GB');
    expect(formatSplitCountryAudienceLabel(['US', 'CA'], ['GB'])).toBe(
      'Include: US, CA · Exclude: GB'
    );
  });
});
