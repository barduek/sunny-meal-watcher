import { METERS_PER_DEGREE_LAT, metersPerDegreeLng, type LngLat } from '../geo/local';
import type { SunPosition } from '../sun/sunPosition';

const DEG = Math.PI / 180;

/** Tope para las sombras con el sol casi en el horizonte (a 1° de altura, un edificio de 9 m da ~515 m). */
export const MAX_SHADOW_LENGTH_M = 500;

/** Las piezas más chicas que esto (aristas casi paralelas a la sombra) se descartan. */
const MIN_PIECE_AREA_M2 = 0.01;

/** Desplazamiento en metros de la sombra de un punto a `height` metros; null si no hay sol. */
export function shadowVector(
  height: number,
  { azimuth, altitude }: SunPosition,
  maxLength = MAX_SHADOW_LENGTH_M,
): { east: number; north: number } | null {
  if (altitude <= 0 || height <= 0) return null;
  const length = Math.min(height / Math.tan(altitude * DEG), maxLength);
  // La sombra cae del lado opuesto al sol.
  return { east: -length * Math.sin(azimuth * DEG), north: -length * Math.cos(azimuth * DEG) };
}

/** Área con signo en m² (positiva = antihoraria), aproximando localmente grados a metros. */
export function signedAreaM2(ring: LngLat[]): number {
  const first = ring[0];
  if (!first) return 0;
  const kx = metersPerDegreeLng(first[1]);
  const ky = METERS_PER_DEGREE_LAT;
  let twiceArea = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i] as LngLat;
    const [x2, y2] = ring[i + 1] as LngLat;
    twiceArea += (x1 - first[0]) * kx * ((y2 - first[1]) * ky) - (x2 - first[0]) * kx * ((y1 - first[1]) * ky);
  }
  return twiceArea / 2;
}

/** Anillo en sentido antihorario (regla de GeoJSON). */
function counterClockwise(ring: LngLat[]): LngLat[] {
  return signedAreaM2(ring) < 0 ? [...ring].reverse() : ring;
}

/**
 * Sombra en el suelo de un prisma (huella + altura) con el sol en `sun`: es la
 * huella "barrida" en la dirección de la sombra. Equivale a la huella más un
 * paralelogramo (la arista y su copia desplazada) por cada arista que mira
 * hacia el lado contrario al sol. Las demás aristas quedan cubiertas por esas
 * piezas. Funciona igual para huellas cóncavas (en L, en U).
 *
 * Es la misma regla que aplica en la GPU `src/map/shadowsLayer.ts`, así que sirve
 * de referencia y para consultas puntuales (¿este punto está a la sombra?).
 * Devuelve las piezas como anillos cerrados, o [] si es de noche.
 */
export function projectShadow(footprint: LngLat[], height: number, sun: SunPosition): LngLat[][] {
  const first = footprint[0];
  const vector = shadowVector(height, sun);
  if (!first || !vector || footprint.length < 4) return [];

  const ring = counterClockwise(footprint);
  const kx = metersPerDegreeLng(first[1]);
  const dLng = vector.east / kx;
  const dLat = vector.north / METERS_PER_DEGREE_LAT;
  const shift = ([lng, lat]: LngLat): LngLat => [lng + dLng, lat + dLat];

  const pieces: LngLat[][] = [ring];
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i] as LngLat;
    const b = ring[i + 1] as LngLat;
    // Normal exterior de la arista en metros (anillo antihorario): (dy, −dx).
    const normalEast = (b[1] - a[1]) * METERS_PER_DEGREE_LAT;
    const normalNorth = -(b[0] - a[0]) * kx;
    if (normalEast * vector.east + normalNorth * vector.north <= 0) continue;

    const quad: LngLat[] = [a, b, shift(b), shift(a), a];
    if (Math.abs(signedAreaM2(quad)) >= MIN_PIECE_AREA_M2) pieces.push(counterClockwise(quad));
  }
  return pieces;
}
