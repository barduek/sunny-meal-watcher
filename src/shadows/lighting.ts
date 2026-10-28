import type { SunPosition } from '../sun/sunPosition';

const DEG = Math.PI / 180;

/** Vector en el sistema local: [este, norte, arriba]. */
export type Vec3 = [number, number, number];

/**
 * Dirección hacia el sol, en el sistema local (este, norte, arriba). El azimut
 * se mide desde el norte en sentido horario, como en SunCalc.
 */
export function sunDirection({ azimuth, altitude }: SunPosition): Vec3 {
  const horizontal = Math.cos(altitude * DEG);
  return [Math.sin(azimuth * DEG) * horizontal, Math.cos(azimuth * DEG) * horizontal, Math.sin(altitude * DEG)];
}

/** Hay sol directo posible solo con el sol sobre el horizonte. */
export const isDaytime = ({ altitude }: SunPosition): boolean => altitude > 0;
