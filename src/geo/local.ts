/** Posición [lng, lat] en grados. */
export type LngLat = [number, number];

/** Área [oeste, sur, este, norte] en grados. */
export type Bbox = [number, number, number, number];

/** Metros por grado de latitud (aproximación esférica, sobra a escala de barrio). */
export const METERS_PER_DEGREE_LAT = 111_320;

const EARTH_CIRCUMFERENCE_M = 40_075_016.686;
const DEG = Math.PI / 180;

export function metersPerDegreeLng(lat: number): number {
  return METERS_PER_DEGREE_LAT * Math.cos(lat * DEG);
}

/** Desplaza una posición `east` metros hacia el este y `north` metros hacia el norte. */
export function offsetLngLat([lng, lat]: LngLat, east: number, north: number): LngLat {
  return [lng + east / metersPerDegreeLng(lat), lat + north / METERS_PER_DEGREE_LAT];
}

/** Metros por pixel CSS con la cámara vertical (MapLibre usa tiles de 512 px). */
export function metersPerPixel(zoom: number, lat: number): number {
  return (EARTH_CIRCUMFERENCE_M * Math.cos(lat * DEG)) / (512 * 2 ** zoom);
}
