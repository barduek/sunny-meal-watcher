import { describe, expect, it } from 'vitest';
import { METERS_PER_DEGREE_LAT, metersPerDegreeLng, metersPerPixel, offsetLngLat, type LngLat } from '../geo/local';
import { sunDomePoint } from './dome';

const center: LngLat = [-58.4303, -34.5889];

/** Desplazamiento en metros (este, norte) entre dos posiciones cercanas. */
function metersBetween(from: LngLat, to: LngLat): [number, number] {
  return [(to[0] - from[0]) * metersPerDegreeLng(from[1]), (to[1] - from[1]) * METERS_PER_DEGREE_LAT];
}

describe('geo/local', () => {
  it('desplaza posiciones en metros', () => {
    const [east, north] = metersBetween(center, offsetLngLat(center, 100, -50));
    expect(east).toBeCloseTo(100, 6);
    expect(north).toBeCloseTo(-50, 6);
  });

  it('calcula metros por pixel en la escala de MapLibre (tiles de 512 px)', () => {
    // En el ecuador, zoom 0: la circunferencia entera entra en 512 px
    expect(metersPerPixel(0, 0)).toBeCloseTo(40_075_016.686 / 512, 3);
    expect(metersPerPixel(16, -34.6)).toBeCloseTo(0.983, 2);
  });
});

describe('sunDomePoint', () => {
  it('con el sol en el horizonte al norte queda a un radio de distancia, al ras del suelo', () => {
    const { lngLat, height } = sunDomePoint(center, 300, { azimuth: 0, altitude: 0 });
    const [east, north] = metersBetween(center, lngLat);
    expect(east).toBeCloseTo(0, 6);
    expect(north).toBeCloseTo(300, 6);
    expect(height).toBeCloseTo(0, 6);
  });

  it('con el sol en el cenit queda justo arriba del centro', () => {
    const { lngLat, height } = sunDomePoint(center, 300, { azimuth: 123, altitude: 90 });
    const [east, north] = metersBetween(center, lngLat);
    expect(Math.hypot(east, north)).toBeLessThan(1e-6);
    expect(height).toBeCloseTo(300, 6);
  });

  it('con el sol a 30° al este reparte la distancia entre horizontal y altura', () => {
    const { lngLat, height } = sunDomePoint(center, 200, { azimuth: 90, altitude: 30 });
    const [east, north] = metersBetween(center, lngLat);
    expect(east).toBeCloseTo(200 * Math.cos(Math.PI / 6), 6);
    expect(north).toBeCloseTo(0, 6);
    expect(height).toBeCloseTo(100, 6);
  });
});
