import politicalWorld from '../src/generated/world-countries.json';
import {countryCodeFromGpsCoordinates} from '../src/QSessionCountry';

describe('Q Session GPS country fallback', () => {
  it('resolves Colombia locally when Android Geocoder returns no country', () => {
    expect(countryCodeFromGpsCoordinates(politicalWorld, 4.711, -74.0721)).toBe('CO');
  });

  it('rejects invalid coordinates instead of inventing a country', () => {
    expect(countryCodeFromGpsCoordinates(politicalWorld, 120, -74)).toBe('');
  });
});
