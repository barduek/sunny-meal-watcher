import { describe, expect, it } from 'vitest';
import {
  formatClock,
  formatMinutes,
  fromZonedDateTime,
  localDayRange,
  timeZoneOffsetMs,
  toZonedDateTime,
} from './time';

const BA = 'America/Argentina/Buenos_Aires';

describe('zona horaria de Buenos Aires (UTC−3, sin horario de verano)', () => {
  it('tiene un offset de −3 horas', () => {
    expect(timeZoneOffsetMs(new Date('2026-06-21T12:00:00Z'), BA)).toBe(-3 * 3600_000);
  });

  it('convierte hora local a instante UTC', () => {
    expect(fromZonedDateTime({ date: '2026-06-21', minutes: 12 * 60 }, BA).toISOString()).toBe(
      '2026-06-21T15:00:00.000Z',
    );
  });

  it('convierte instante UTC a fecha y hora local, cambiando de día si corresponde', () => {
    expect(toZonedDateTime(new Date('2026-06-21T02:30:00Z'), BA)).toEqual({ date: '2026-06-20', minutes: 23 * 60 + 30 });
  });

  it('ida y vuelta conserva fecha y minutos', () => {
    const local = { date: '2026-12-31', minutes: 23 * 60 + 55 };
    expect(toZonedDateTime(fromZonedDateTime(local, BA), BA)).toEqual(local);
  });

  it('da el rango de medianoche a medianoche del día local', () => {
    const { start, end } = localDayRange('2026-09-26', BA);
    expect(start.toISOString()).toBe('2026-09-26T03:00:00.000Z');
    expect(end.toISOString()).toBe('2026-09-27T03:00:00.000Z');
  });
});

describe('zonas con horario de verano', () => {
  it('usa el offset vigente en cada fecha (Madrid: +1 en invierno, +2 en verano)', () => {
    expect(fromZonedDateTime({ date: '2026-01-15', minutes: 12 * 60 }, 'Europe/Madrid').toISOString()).toBe(
      '2026-01-15T11:00:00.000Z',
    );
    expect(fromZonedDateTime({ date: '2026-07-15', minutes: 12 * 60 }, 'Europe/Madrid').toISOString()).toBe(
      '2026-07-15T10:00:00.000Z',
    );
  });
});

describe('formato', () => {
  it('formatea minutos y horas locales como HH:MM', () => {
    expect(formatMinutes(0)).toBe('00:00');
    expect(formatMinutes(9 * 60 + 5)).toBe('09:05');
    expect(formatClock(new Date('2026-06-21T15:30:00Z'), BA)).toBe('12:30');
  });
});

describe('fecha inválida', () => {
  it('rechaza formatos que no son YYYY-MM-DD', () => {
    expect(() => fromZonedDateTime({ date: '21/06/2026', minutes: 0 }, BA)).toThrow(/Fecha inválida/);
  });
});
