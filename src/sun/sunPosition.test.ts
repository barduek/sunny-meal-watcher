import { describe, expect, it } from 'vitest';
import { PALERMO } from '../config';
import { getSunPath, getSunPosition, getSunTimes } from './sunPosition';
import { localDayRange } from './time';

const center = PALERMO.center;
const latitude = center[1];

/** Diferencia angular mínima entre dos azimuts (maneja el salto 359° → 0°). */
function azimuthDiff(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

describe('getSunPosition en Palermo', () => {
  it('al mediodía solar del solsticio de verano el sol está alto y al norte', () => {
    const { solarNoon } = getSunTimes(new Date('2026-12-21T15:00:00Z'), center);
    const sun = getSunPosition(solarNoon, center);
    // Altura esperada: 90° − |latitud − declinación| = 90 − (34,59 − 23,44)
    expect(sun.altitude).toBeCloseTo(90 - (Math.abs(latitude) - 23.44), 0);
    expect(azimuthDiff(sun.azimuth, 0)).toBeLessThan(1);
  });

  it('al mediodía solar del solsticio de invierno el sol está bajo y al norte', () => {
    const { solarNoon } = getSunTimes(new Date('2026-06-21T15:00:00Z'), center);
    const sun = getSunPosition(solarNoon, center);
    expect(sun.altitude).toBeCloseTo(90 - (Math.abs(latitude) + 23.44), 0);
    expect(azimuthDiff(sun.azimuth, 0)).toBeLessThan(1);
  });

  it('en el equinoccio sale por el este y se pone por el oeste', () => {
    const { sunrise, sunset } = getSunTimes(new Date('2026-03-20T15:00:00Z'), center);
    expect(sunrise).not.toBeNull();
    expect(sunset).not.toBeNull();
    expect(azimuthDiff(getSunPosition(sunrise as Date, center).azimuth, 90)).toBeLessThan(2);
    expect(azimuthDiff(getSunPosition(sunset as Date, center).azimuth, 270)).toBeLessThan(2);
  });

  it('a la medianoche local el sol está bajo el horizonte', () => {
    expect(getSunPosition(new Date('2026-09-26T03:00:00Z'), center).altitude).toBeLessThan(0);
  });
});

describe('getSunPath', () => {
  it('incluye solo posiciones diurnas, con más horas de sol en verano que en invierno', () => {
    const summer = localDayRange('2026-12-21', PALERMO.timeZone);
    const winter = localDayRange('2026-06-21', PALERMO.timeZone);
    const summerPath = getSunPath(summer.start, summer.end, center, 20);
    const winterPath = getSunPath(winter.start, winter.end, center, 20);

    expect(summerPath.every((p) => p.altitude > 0)).toBe(true);
    // ~14,5 h de sol en diciembre vs ~9,8 h en junio → puntos cada 20 minutos
    expect(summerPath.length).toBeGreaterThan(40);
    expect(winterPath.length).toBeLessThan(32);
  });
});
