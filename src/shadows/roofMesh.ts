import earcut from 'earcut';
import type { Building, LngLat } from '../buildings/types';
import { toLocalMeters, type LocalFrame } from './gpuGeometry';

/** Floats por vértice de techo: x, y (metros locales) y altura. */
export const FLOATS_PER_ROOF_VERTEX = 3;

export interface RoofMesh {
  vertices: Float32Array;
  indices: Uint32Array;
}

/**
 * Triangula los techos de los edificios (huellas llanas a la altura de cada
 * uno). Cada edificio aporta sus propios vértices, así que los índices de una
 * zona nunca se mezclan con los de otra.
 */
export function buildRoofMesh(buildings: Building[], frame: LocalFrame): RoofMesh {
  const vertices: number[] = [];
  const indices: number[] = [];

  for (const { footprint, height } of buildings) {
    // El anillo viene cerrado: el último punto repite el primero.
    const count = footprint.length - 1;
    if (count < 3) continue;

    const flat = new Array<number>(count * 2);
    for (let i = 0; i < count; i++) {
      const [x, y] = toLocalMeters(frame, footprint[i] as LngLat);
      flat[i * 2] = x;
      flat[i * 2 + 1] = y;
    }

    const triangles = earcut(flat);
    if (triangles.length === 0) continue;

    const base = vertices.length / FLOATS_PER_ROOF_VERTEX;
    for (let i = 0; i < count; i++) vertices.push(flat[i * 2] as number, flat[i * 2 + 1] as number, height);
    for (const index of triangles) indices.push(base + index);
  }

  return { vertices: new Float32Array(vertices), indices: new Uint32Array(indices) };
}
