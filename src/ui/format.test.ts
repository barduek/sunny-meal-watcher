import { describe, expect, it } from 'vitest';
import {
  cardinalDirection,
  describeBuildingData,
  describeLoadProgress,
  describeSnapshot,
  describeSunPosition,
  describeSunTimes,
} from './format';

const BA = 'America/Argentina/Buenos_Aires';

describe('cardinalDirection', () => {
  it('redondea al viento más cercano, incluido el salto de 360° a 0°', () => {
    expect(cardinalDirection(0)).toBe('N');
    expect(cardinalDirection(359)).toBe('N');
    expect(cardinalDirection(90)).toBe('E');
    expect(cardinalDirection(180)).toBe('S');
    expect(cardinalDirection(202.5)).toBe('SSO');
    expect(cardinalDirection(286)).toBe('ONO');
    expect(cardinalDirection(-90)).toBe('O');
  });
});

describe('describeSunPosition', () => {
  it('describe dirección y altura redondeadas', () => {
    expect(describeSunPosition({ azimuth: 286.4, altitude: 24.6 })).toBe('Sol al ONO (286°), a 25° de altura');
  });

  it('avisa cuando el sol está bajo el horizonte', () => {
    expect(describeSunPosition({ azimuth: 200, altitude: -3 })).toBe('El sol está bajo el horizonte');
  });
});

describe('describeSunTimes', () => {
  it('muestra salida y puesta en hora local', () => {
    const times = {
      sunrise: new Date('2026-09-26T09:52:00Z'),
      sunset: new Date('2026-09-26T22:13:00Z'),
      solarNoon: new Date('2026-09-26T16:02:00Z'),
    };
    expect(describeSunTimes(times, BA)).toBe('Sale 06:52 · se pone 19:13');
  });

  it('contempla días sin salida ni puesta', () => {
    expect(describeSunTimes({ sunrise: null, sunset: null, solarNoon: new Date() }, BA)).toMatch(/no sale/);
  });
});

describe('describeSnapshot', () => {
  it('arma los textos del panel', () => {
    const view = describeSnapshot(
      { date: '2026-09-26', minutes: 16 * 60 + 45 },
      { azimuth: 286, altitude: 25 },
      { sunrise: new Date('2026-09-26T09:52:00Z'), sunset: new Date('2026-09-26T22:13:00Z'), solarNoon: new Date() },
      BA,
    );
    expect(view).toEqual({ time: '16:45', sun: 'Sol al ONO (286°), a 25° de altura', times: 'Sale 06:52 · se pone 19:13' });
  });
});

describe('describeBuildingData', () => {
  it('informa la fuente y cuántos volúmenes usan la altura supuesta', () => {
    expect(describeBuildingData({ loaded: 1673, total: 1673, assumed: 473 }, 'OpenStreetMap')).toBe(
      '1.673 volúmenes edificados · OpenStreetMap · 473 sin altura cargada (se asumen 9 m)',
    );
  });

  it('omite la aclaración si todos tienen altura', () => {
    expect(describeBuildingData({ loaded: 1, total: 1, assumed: 0 }, 'Tejido Urbano del GCBA (2021)')).toBe(
      '1 volumen edificado · Tejido Urbano del GCBA (2021)',
    );
  });

  it('mientras se cargan zonas muestra cuántos van de cuántos', () => {
    expect(describeBuildingData({ loaded: 12340, total: 50759, assumed: 0 }, 'Tejido Urbano del GCBA (2021)')).toBe(
      '12.340 de 50.759 volúmenes edificados · Tejido Urbano del GCBA (2021)',
    );
  });
});

describe('describeLoadProgress', () => {
  it('cuenta las zonas que faltan, en singular o plural', () => {
    expect(describeLoadProgress(1)).toBe('Cargando edificios… falta 1 zona');
    expect(describeLoadProgress(7)).toBe('Cargando edificios… faltan 7 zonas');
  });
});
