import { getPosition, getTimes } from 'suncalc';
import type { LngLat } from '../geo/local';

/**
 * Posición del sol en grados (convención de SunCalc 2):
 * azimut desde el norte en sentido horario (0 = N, 90 = E, 180 = S, 270 = O)
 * y altura aparente sobre el horizonte (0 = horizonte, 90 = cenit).
 */
export interface SunPosition {
  azimuth: number;
  altitude: number;
}

export function getSunPosition(date: Date, [lng, lat]: LngLat): SunPosition {
  const { azimuth, altitude } = getPosition(date, lat, lng);
  return { azimuth, altitude };
}

export interface SunTimes {
  sunrise: Date | null;
  sunset: Date | null;
  solarNoon: Date;
}

/** Salida, puesta y mediodía solar del día solar que contiene a `date`. */
export function getSunTimes(date: Date, [lng, lat]: LngLat): SunTimes {
  const { sunrise, sunset, solarNoon } = getTimes(date, lat, lng);
  return { sunrise, sunset, solarNoon };
}

/** Recorrido del sol entre dos instantes, cada `stepMinutes`, solo mientras está sobre el horizonte. */
export function getSunPath(from: Date, to: Date, center: LngLat, stepMinutes = 20): SunPosition[] {
  const path: SunPosition[] = [];
  for (let time = from.getTime(); time <= to.getTime(); time += stepMinutes * 60_000) {
    const position = getSunPosition(new Date(time), center);
    if (position.altitude > 0) path.push(position);
  }
  return path;
}
