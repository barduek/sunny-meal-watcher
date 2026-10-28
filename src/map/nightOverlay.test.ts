import { describe, expect, it } from 'vitest';
import { CIVIL_TWILIGHT_DEG, nightFactor } from './nightOverlay';

describe('nightFactor', () => {
  it('es 0 con el sol sobre el horizonte', () => {
    expect(nightFactor(30)).toBe(0);
    expect(nightFactor(0)).toBe(0);
  });

  it('crece de forma gradual durante el crepúsculo', () => {
    expect(nightFactor(-3)).toBeCloseTo(0.5, 9);
  });

  it('es 1 pasado el crepúsculo civil', () => {
    expect(nightFactor(CIVIL_TWILIGHT_DEG)).toBe(1);
    expect(nightFactor(-40)).toBe(1);
  });
});
