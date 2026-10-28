import { describe, expect, it } from 'vitest';
import { isDaytime, sunDirection } from './lighting';

describe('sunDirection', () => {
  it('con el sol en el horizonte al este apunta al este', () => {
    const [east, north, up] = sunDirection({ azimuth: 90, altitude: 0 });
    expect(east).toBeCloseTo(1, 9);
    expect(north).toBeCloseTo(0, 9);
    expect(up).toBeCloseTo(0, 9);
  });

  it('con el sol al norte a 30° apunta al norte y hacia arriba', () => {
    const [east, north, up] = sunDirection({ azimuth: 0, altitude: 30 });
    expect(east).toBeCloseTo(0, 9);
    expect(north).toBeCloseTo(Math.cos(Math.PI / 6), 9);
    expect(up).toBeCloseTo(0.5, 9);
  });

  it('con el sol en el cenit apunta hacia arriba', () => {
    const [east, north, up] = sunDirection({ azimuth: 200, altitude: 90 });
    expect(east).toBeCloseTo(0, 9);
    expect(north).toBeCloseTo(0, 9);
    expect(up).toBeCloseTo(1, 9);
  });

  it('es un vector unitario', () => {
    const [east, north, up] = sunDirection({ azimuth: 286.4, altitude: 24.6 });
    expect(Math.hypot(east, north, up)).toBeCloseTo(1, 9);
  });
});

describe('isDaytime', () => {
  it('es de día solo con el sol sobre el horizonte', () => {
    expect(isDaytime({ azimuth: 0, altitude: 0.1 })).toBe(true);
    expect(isDaytime({ azimuth: 0, altitude: 0 })).toBe(false);
    expect(isDaytime({ azimuth: 0, altitude: -10 })).toBe(false);
  });
});
