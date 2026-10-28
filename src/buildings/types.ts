import type { LngLat } from '../geo/local';

export type { LngLat };

/** De dónde salió la altura de un edificio (indica qué tan confiable es). */
export type HeightSource = 'height' | 'levels' | 'default';

/** Edificio normalizado: un prisma de huella + altura uniforme. */
export interface Building {
  id: string;
  /** Anillo exterior cerrado: el primer punto se repite al final. */
  footprint: LngLat[];
  /** Altura en metros. */
  height: number;
  heightSource: HeightSource;
}
