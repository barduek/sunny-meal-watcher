import { describe, expect, it } from 'vitest';
import { PALERMO } from './config';

describe('PALERMO', () => {
  it('tiene un bbox bien formado que contiene al centro', () => {
    const [west, south, east, north] = PALERMO.bbox;
    const [lng, lat] = PALERMO.center;

    expect(west).toBeLessThan(east);
    expect(south).toBeLessThan(north);
    expect(lng).toBeGreaterThan(west);
    expect(lng).toBeLessThan(east);
    expect(lat).toBeGreaterThan(south);
    expect(lat).toBeLessThan(north);
  });

  it('usa una zona horaria reconocida por el runtime', () => {
    expect(() => new Intl.DateTimeFormat('es-AR', { timeZone: PALERMO.timeZone })).not.toThrow();
  });
});
