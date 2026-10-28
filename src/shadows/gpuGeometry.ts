import type { Building } from '../buildings/types';
import type { LngLat } from '../geo/local';

/**
 * Geometría para dibujar las sombras en la GPU. Las aristas de todos los
 * edificios se cargan una sola vez, en metros relativos a un origen cercano
 * (así la precisión de float32 alcanza). Cada cambio de hora solo actualiza la
 * dirección de la sombra.
 */

/** Radio terrestre que usa MapLibre para convertir metros a unidades Mercator. */
const EARTH_RADIUS_M = 6_371_008.8;

export function mercatorX(lng: number): number {
  return (180 + lng) / 360;
}

export function mercatorY(lat: number): number {
  return (180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))) / 360;
}

/** Sistema local: metros (este, norte) desde un origen, en la misma proyección que el mapa. */
export interface LocalFrame {
  originX: number;
  originY: number;
  /** Unidades Mercator por metro en el origen. */
  unitsPerMeter: number;
}

export function createLocalFrame([lng, lat]: LngLat): LocalFrame {
  const circumference = 2 * Math.PI * EARTH_RADIUS_M;
  return { originX: mercatorX(lng), originY: mercatorY(lat), unitsPerMeter: 1 / (circumference * Math.cos((lat * Math.PI) / 180)) };
}

export function toLocalMeters(frame: LocalFrame, [lng, lat]: LngLat): [number, number] {
  // En Mercator la Y crece hacia el sur; en el sistema local, el norte es positivo.
  return [(mercatorX(lng) - frame.originX) / frame.unitsPerMeter, (frame.originY - mercatorY(lat)) / frame.unitsPerMeter];
}

/** Matriz 4×4 (column-major) de metros locales a coordenadas Mercator. La Y se invierte porque en Mercator crece hacia el sur. */
export function localToMercatorMatrix({ originX, originY, unitsPerMeter: s }: LocalFrame): Float64Array {
  return new Float64Array([s, 0, 0, 0, 0, -s, 0, 0, 0, 0, s, 0, originX, originY, 0, 1]);
}

/** Producto de matrices 4×4 column-major (a × b) en doble precisión. */
export function multiplyMat4(a: ArrayLike<number>, b: ArrayLike<number>): Float64Array {
  const out = new Float64Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += (a[k * 4 + row] as number) * (b[col * 4 + k] as number);
      out[col * 4 + row] = sum;
    }
  }
  return out;
}

/** Floats por arista en el buffer: ax, ay, bx, by (metros locales) y la altura del edificio. */
export const FLOATS_PER_EDGE = 5;

/**
 * Aristas de todos los edificios, con cada anillo en sentido antihorario. Así la
 * normal exterior de la arista (a → b) es (dy, −dx), y el shader puede decidir
 * qué aristas proyectan sombra: las que miran hacia el lado contrario al sol.
 */
export function buildEdgeInstances(buildings: Building[], frame: LocalFrame): Float32Array {
  const maxEdges = buildings.reduce((sum, building) => sum + Math.max(building.footprint.length - 1, 0), 0);
  const data = new Float32Array(maxEdges * FLOATS_PER_EDGE);
  let offset = 0;

  for (const { footprint, height } of buildings) {
    const ring = footprint.map((point) => toLocalMeters(frame, point));
    let twiceArea = 0;
    for (let i = 0; i < ring.length - 1; i++) {
      const [x1, y1] = ring[i] as [number, number];
      const [x2, y2] = ring[i + 1] as [number, number];
      twiceArea += x1 * y2 - x2 * y1;
    }
    if (twiceArea < 0) ring.reverse();

    for (let i = 0; i < ring.length - 1; i++) {
      const [ax, ay] = ring[i] as [number, number];
      const [bx, by] = ring[i + 1] as [number, number];
      if (ax === bx && ay === by) continue;
      data.set([ax, ay, bx, by, height], offset);
      offset += FLOATS_PER_EDGE;
    }
  }
  return data.subarray(0, offset);
}
