type PoliticalCountry = {
  code: string;
  x: number;
  y: number;
  bounds?: number[];
};

type PoliticalWorld = {
  countries: PoliticalCountry[];
  microstates: PoliticalCountry[];
};

export function countryCodeFromGpsCoordinates(
  world: PoliticalWorld,
  latitudeValue: number,
  longitudeValue: number,
): string {
  const latitude = Number(latitudeValue);
  const longitude = Number(longitudeValue);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)
    || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return '';

  const x = ((longitude + 180) / 360) * 1000;
  const y = ((90 - latitude) / 180) * 500;
  const nearbyMicrostate = world.microstates
    .map(country => ({country, distance: Math.hypot(country.x - x, country.y - y)}))
    .filter(item => item.distance <= 4)
    .sort((left, right) => left.distance - right.distance)[0];
  if (nearbyMicrostate) return nearbyMicrostate.country.code;

  const bounded = world.countries
    .filter(country => Array.isArray(country.bounds)
      && x >= country.bounds[0] && x <= country.bounds[2]
      && y >= country.bounds[1] && y <= country.bounds[3])
    .sort((left, right) => {
      const leftBounds = left.bounds as number[];
      const rightBounds = right.bounds as number[];
      const leftArea = (leftBounds[2] - leftBounds[0]) * (leftBounds[3] - leftBounds[1]);
      const rightArea = (rightBounds[2] - rightBounds[0]) * (rightBounds[3] - rightBounds[1]);
      return leftArea - rightArea;
    })[0];
  return bounded?.code || '';
}
