import { DEFAULT_HEIGHT_M } from '../buildings/normalize';
import type { SunPosition, SunTimes } from '../sun/sunPosition';
import { formatClock, formatMinutes, type ZonedDateTime } from '../sun/time';

/** Rosa de 16 vientos en castellano (O = oeste). */
const WINDS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO'];

/** Azimut (grados desde el norte) → punto cardinal abreviado. */
export function cardinalDirection(azimuth: number): string {
  const normalized = ((azimuth % 360) + 360) % 360;
  return WINDS[Math.round(normalized / 22.5) % WINDS.length] as string;
}

export function describeSunPosition({ azimuth, altitude }: SunPosition): string {
  if (altitude <= 0) return 'El sol está bajo el horizonte';
  return `Sol al ${cardinalDirection(azimuth)} (${Math.round(azimuth)}°), a ${Math.round(altitude)}° de altura`;
}

export function describeSunTimes({ sunrise, sunset }: SunTimes, timeZone: string): string {
  if (!sunrise || !sunset) return 'Este día el sol no sale ni se pone';
  return `Sale ${formatClock(sunrise, timeZone)} · se pone ${formatClock(sunset, timeZone)}`;
}

export interface SnapshotView {
  time: string;
  sun: string;
  times: string;
}

/** Textos del panel para una fecha y hora. */
export function describeSnapshot(
  local: ZonedDateTime,
  sun: SunPosition,
  times: SunTimes,
  timeZone: string,
): SnapshotView {
  return { time: formatMinutes(local.minutes), sun: describeSunPosition(sun), times: describeSunTimes(times, timeZone) };
}

const count = new Intl.NumberFormat('es-AR');

/** Cuántos volúmenes edificados hay cargados, cuántos tiene el dataset y cuántos usan la altura supuesta. */
export interface BuildingStats {
  loaded: number;
  total: number;
  assumed: number;
}

/** Nota sobre los datos: fuente, cuántos volúmenes hay cargados y cuántos usan la altura supuesta. */
export function describeBuildingData({ loaded, total, assumed }: BuildingStats, sourceName: string): string {
  const noun = total === 1 ? 'volumen edificado' : 'volúmenes edificados';
  const amount = loaded < total ? `${count.format(loaded)} de ${count.format(total)}` : count.format(loaded);
  const parts = [`${amount} ${noun}`, sourceName];
  if (assumed > 0) parts.push(`${count.format(assumed)} sin altura cargada (se asumen ${DEFAULT_HEIGHT_M} m)`);
  return parts.join(' · ');
}

/** Aviso mientras se descargan zonas de edificios. */
export function describeLoadProgress(pending: number): string {
  return `Cargando edificios… ${pending === 1 ? 'falta 1 zona' : `faltan ${count.format(pending)} zonas`}`;
}
