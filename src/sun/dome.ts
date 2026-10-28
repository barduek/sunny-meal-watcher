import { offsetLngLat, type LngLat } from '../geo/local';
import type { SunPosition } from './sunPosition';

const DEG = Math.PI / 180;

/**
 * Para dibujar el sol se usa una "cúpula celeste" chica centrada en lo que mira
 * la cámara: el sol queda sobre esa semiesfera, en su dirección real.
 */
export interface DomePoint {
  lngLat: LngLat;
  /** Altura en metros sobre el suelo. */
  height: number;
}

/** Punto de la cúpula de radio `radius` (metros) sobre `center` en la dirección del sol. */
export function sunDomePoint(center: LngLat, radius: number, { azimuth, altitude }: SunPosition): DomePoint {
  const horizontal = radius * Math.cos(altitude * DEG);
  return {
    lngLat: offsetLngLat(center, horizontal * Math.sin(azimuth * DEG), horizontal * Math.cos(azimuth * DEG)),
    height: radius * Math.sin(altitude * DEG),
  };
}
