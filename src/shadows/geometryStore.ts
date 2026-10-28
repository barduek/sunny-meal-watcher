import type { Building } from '../buildings/types';
import type { Bbox, LngLat } from '../geo/local';
import {
  FLOATS_PER_EDGE,
  buildEdgeInstances,
  createLocalFrame,
  localToMercatorMatrix,
  toLocalMeters,
  type LocalFrame,
} from './gpuGeometry';
import { buildRoofMesh } from './roofMesh';
import type { LocalBounds } from './shadowCeiling';

/**
 * Geometría de los edificios de una zona, lista para dibujar:
 * - aristas (una por pared y también para las sombras del suelo), y
 * - la malla triangulada de los techos.
 * Todo en metros locales (ver `LocalFrame`).
 */
export interface ChunkGeometry {
  edges: Float32Array;
  edgeCount: number;
  roofVertices: Float32Array;
  roofIndices: Uint32Array;
  /** Altura del edificio más alto de la zona (m). */
  maxHeight: number;
}

/** Null si la zona no tiene ningún edificio dibujable. */
export function buildChunkGeometry(buildings: Building[], frame: LocalFrame): ChunkGeometry | null {
  const edges = buildEdgeInstances(buildings, frame);
  if (edges.length === 0) return null;

  const { vertices, indices } = buildRoofMesh(buildings, frame);
  let maxHeight = 0;
  for (const building of buildings) maxHeight = Math.max(maxHeight, building.height);

  return { edges, edgeCount: edges.length / FLOATS_PER_EDGE, roofVertices: vertices, roofIndices: indices, maxHeight };
}

/**
 * Los edificios cargados hasta ahora. Las capas del mapa que los dibujan
 * (edificios, sombras en el suelo, techo de sombra) leen de acá y suben cada
 * zona a la GPU una sola vez.
 */
export class GeometryStore {
  readonly frame: LocalFrame;
  /** Matriz de metros locales a Mercator, en doble precisión. */
  readonly model: Float64Array;
  readonly chunks: ChunkGeometry[] = [];
  /** Cambia cada vez que llegan edificios nuevos: sirve para saber qué hay que recalcular. */
  version = 0;
  /** Altura del edificio más alto cargado (m). */
  maxHeight = 0;

  constructor(origin: LngLat) {
    this.frame = createLocalFrame(origin);
    this.model = localToMercatorMatrix(this.frame);
  }

  /** Suma los edificios de una zona. Devuelve false si no había nada para sumar. */
  add(buildings: Building[]): boolean {
    const chunk = buildChunkGeometry(buildings, this.frame);
    if (!chunk) return false;
    this.chunks.push(chunk);
    this.maxHeight = Math.max(this.maxHeight, chunk.maxHeight);
    this.version += 1;
    return true;
  }
}

/** El área en metros locales, con un margen (para los edificios que cruzan el borde). */
export function areaLocalBounds(frame: LocalFrame, [west, south, east, north]: Bbox, margin = 0): LocalBounds {
  const corners = [
    toLocalMeters(frame, [west, south]),
    toLocalMeters(frame, [east, south]),
    toLocalMeters(frame, [east, north]),
    toLocalMeters(frame, [west, north]),
  ];
  const xs = corners.map(([x]) => x);
  const ys = corners.map(([, y]) => y);
  return {
    minX: Math.min(...xs) - margin,
    minY: Math.min(...ys) - margin,
    maxX: Math.max(...xs) + margin,
    maxY: Math.max(...ys) + margin,
  };
}
