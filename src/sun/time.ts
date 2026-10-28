/**
 * Fecha y hora "de reloj" en una zona horaria. La app trabaja con la hora local
 * de la zona elegida (Buenos Aires), sin importar la zona del navegador.
 */
export interface ZonedDateTime {
  /** Fecha local en formato `YYYY-MM-DD` (el mismo de `<input type="date">`). */
  date: string;
  /** Minutos desde la medianoche local (0–1439). */
  minutes: number;
}

type Parts = Record<'year' | 'month' | 'day' | 'hour' | 'minute' | 'second', number>;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

function zonedParts(instant: Date, timeZone: string): Parts {
  const parts: Partial<Parts> = {};
  for (const { type, value } of formatterFor(timeZone).formatToParts(instant)) {
    if (type in { year: 1, month: 1, day: 1, hour: 1, minute: 1, second: 1 }) {
      parts[type as keyof Parts] = Number(value);
    }
  }
  return parts as Parts;
}

/** Diferencia en ms entre la hora local de la zona y UTC en ese instante (Buenos Aires: −3 h). */
export function timeZoneOffsetMs(instant: Date, timeZone: string): number {
  const p = zonedParts(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

const pad = (value: number): string => String(value).padStart(2, '0');

/** Instante → fecha y minutos locales de la zona. */
export function toZonedDateTime(instant: Date, timeZone: string): ZonedDateTime {
  const p = zonedParts(instant, timeZone);
  return { date: `${p.year}-${pad(p.month)}-${pad(p.day)}`, minutes: p.hour * 60 + p.minute };
}

/** Fecha y minutos locales de la zona → instante. Contempla cambios de horario de verano. */
export function fromZonedDateTime({ date, minutes }: ZonedDateTime, timeZone: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new Error(`Fecha inválida: "${date}" (se espera YYYY-MM-DD)`);
  const [, year, month, day] = match.map(Number) as [number, number, number, number];

  const asIfUtc = Date.UTC(year, month - 1, day, 0, minutes);
  const offset = timeZoneOffsetMs(new Date(asIfUtc), timeZone);
  let utc = asIfUtc - offset;
  // Si el offset cambia justo en ese tramo (horario de verano), se corrige con el nuevo.
  const offsetAtResult = timeZoneOffsetMs(new Date(utc), timeZone);
  if (offsetAtResult !== offset) utc = asIfUtc - offsetAtResult;
  return new Date(utc);
}

/** Inicio y fin (medianoche a medianoche) de un día local de la zona. */
export function localDayRange(date: string, timeZone: string): { start: Date; end: Date } {
  return {
    start: fromZonedDateTime({ date, minutes: 0 }, timeZone),
    end: fromZonedDateTime({ date, minutes: 24 * 60 }, timeZone),
  };
}

/** Minutos del día → "HH:MM". */
export function formatMinutes(minutes: number): string {
  return `${pad(Math.floor(minutes / 60) % 24)}:${pad(minutes % 60)}`;
}

/** Hora local "HH:MM" de un instante en la zona. */
export function formatClock(instant: Date, timeZone: string): string {
  return formatMinutes(toZonedDateTime(instant, timeZone).minutes);
}
