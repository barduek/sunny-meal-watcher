import type { Feature, MultiPolygon, Polygon, Position } from 'geojson';
import { METERS_PER_DEGREE_LAT, metersPerDegreeLng, type Bbox, type LngLat } from '../geo/local';

/**
 * Los edificios se publican en "zonas" (chunks): archivos GeoJSON chicos que
 * cubren una porción cuadrada del área, más un índice (`index.json`) que los
 * lista. La app baja el índice y después solo las zonas que están cerca de lo
 * que se mira. Este módulo es compartido por los scripts que generan los datos
 * y por la app que los lee.
 */

/** Versión del formato del índice. Cambia si el formato deja de ser compatible. */
export const MANIFEST_VERSION = 1;

/** De dónde salen los datos: se muestra en el panel y en la atribución del mapa. */
export interface DataSourceInfo {
  name: string;
  url: string;
  license: string;
  /** Crédito para mostrar en el mapa (HTML), obligatorio según la licencia. */
  attribution: string;
}

export interface ChunkEntry {
  id: string;
  /** Ruta del archivo, relativa a la carpeta del índice. */
  file: string;
  /** Área que ocupan los edificios de la zona. */
  bbox: Bbox;
  /** Cantidad de volúmenes edificados. */
  count: number;
}

export interface ChunkManifest {
  version: number;
  /** Identifica el contenido: cambia si cambian los datos (se usa para no servir copias viejas de la caché). */
  dataVersion: string;
  area: string;
  bbox: Bbox;
  chunkSizeM: number;
  total: number;
  generatedAt: string;
  source: DataSourceInfo;
  chunks: ChunkEntry[];
}

const isBbox = (value: unknown): value is Bbox =>
  Array.isArray(value) && value.length === 4 && value.every((n) => typeof n === 'number' && Number.isFinite(n));

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

/** Valida que lo descargado tenga la forma de un índice; si no, es otro archivo (por ejemplo, un 404 en HTML). */
export function isChunkManifest(value: unknown): value is ChunkManifest {
  if (!isRecord(value) || value['version'] !== MANIFEST_VERSION) return false;
  const { dataVersion, total, source, chunks } = value;
  if (typeof dataVersion !== 'string' || typeof total !== 'number') return false;
  if (!isRecord(source) || typeof source['name'] !== 'string' || typeof source['attribution'] !== 'string') return false;
  if (!Array.isArray(chunks)) return false;
  return chunks.every(
    (chunk) =>
      isRecord(chunk) &&
      typeof chunk['id'] === 'string' &&
      typeof chunk['file'] === 'string' &&
      typeof chunk['count'] === 'number' &&
      isBbox(chunk['bbox']),
  );
}

// ---------------------------------------------------------------------------
// Grilla de zonas
// ---------------------------------------------------------------------------

/** Grilla cuadrada de `sizeM` metros que arranca en la esquina sudoeste del área. */
export interface ChunkGrid {
  west: number;
  south: number;
  /** Latitud con la que se pasa de grados de longitud a metros. */
  refLat: number;
  sizeM: number;
}

export interface ChunkCell {
  x: number;
  y: number;
}

export function createChunkGrid([west, south, , north]: Bbox, sizeM: number): ChunkGrid {
  return { west, south, refLat: (south + north) / 2, sizeM };
}

export function chunkCellOf(grid: ChunkGrid, [lng, lat]: LngLat): ChunkCell {
  return {
    x: Math.floor(((lng - grid.west) * metersPerDegreeLng(grid.refLat)) / grid.sizeM),
    y: Math.floor(((lat - grid.south) * METERS_PER_DEGREE_LAT) / grid.sizeM),
  };
}

export function chunkCellBbox(grid: ChunkGrid, { x, y }: ChunkCell): Bbox {
  const kx = metersPerDegreeLng(grid.refLat);
  return [
    grid.west + (x * grid.sizeM) / kx,
    grid.south + (y * grid.sizeM) / METERS_PER_DEGREE_LAT,
    grid.west + ((x + 1) * grid.sizeM) / kx,
    grid.south + ((y + 1) * grid.sizeM) / METERS_PER_DEGREE_LAT,
  ];
}

export const chunkId = ({ x, y }: ChunkCell): string => `${x}_${y}`;

// ---------------------------------------------------------------------------
// Reparto de edificios en zonas (lo usan los scripts)
// ---------------------------------------------------------------------------

export type ChunkableFeature = Feature<Polygon | MultiPolygon>;

function outerRings(feature: ChunkableFeature): Position[][] {
  const { geometry } = feature;
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  return polygons.flatMap((polygon) => (polygon[0] ? [polygon[0]] : []));
}

/** Área que ocupan los anillos exteriores de los features; null si no hay ninguno. */
export function unionBounds(features: ChunkableFeature[]): Bbox | null {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const feature of features) {
    for (const ring of outerRings(feature)) {
      for (const [lng, lat] of ring) {
        west = Math.min(west, lng as number);
        east = Math.max(east, lng as number);
        south = Math.min(south, lat as number);
        north = Math.max(north, lat as number);
      }
    }
  }
  return Number.isFinite(west) && Number.isFinite(south) ? [west, south, east, north] : null;
}

export interface ChunkGroup<F extends ChunkableFeature> {
  cell: ChunkCell;
  features: F[];
}

/** Asigna cada edificio a la zona donde cae el centro de su caja: así nunca queda repetido en dos zonas. */
export function splitIntoChunks<F extends ChunkableFeature>(features: F[], grid: ChunkGrid): Map<string, ChunkGroup<F>> {
  const groups = new Map<string, ChunkGroup<F>>();
  for (const feature of features) {
    const bounds = unionBounds([feature]);
    if (!bounds) continue;
    const cell = chunkCellOf(grid, [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2]);
    const id = chunkId(cell);
    let group = groups.get(id);
    if (!group) {
      group = { cell, features: [] };
      groups.set(id, group);
    }
    group.features.push(feature);
  }
  return groups;
}

export function buildManifest(input: {
  area: string;
  bbox: Bbox;
  chunkSizeM: number;
  source: DataSourceInfo;
  dataVersion: string;
  generatedAt: string;
  chunks: ChunkEntry[];
}): ChunkManifest {
  const chunks = [...input.chunks].sort((a, b) => a.id.localeCompare(b.id));
  return {
    version: MANIFEST_VERSION,
    dataVersion: input.dataVersion,
    area: input.area,
    bbox: input.bbox,
    chunkSizeM: input.chunkSizeM,
    total: chunks.reduce((sum, chunk) => sum + chunk.count, 0),
    generatedAt: input.generatedAt,
    source: input.source,
    chunks,
  };
}

// ---------------------------------------------------------------------------
// Selección de zonas según la vista (lo usa la app)
// ---------------------------------------------------------------------------

export function bboxesIntersect(a: Bbox, b: Bbox): boolean {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

const bboxCenter = ([west, south, east, north]: Bbox): LngLat => [(west + east) / 2, (south + north) / 2];

/** Zonas que tocan `bounds`, ordenadas de la más cercana a `center` a la más lejana. */
export function chunksInBounds(manifest: Pick<ChunkManifest, 'chunks'>, bounds: Bbox, center: LngLat): ChunkEntry[] {
  const kx = metersPerDegreeLng(center[1]);
  const distance = (entry: ChunkEntry): number => {
    const [lng, lat] = bboxCenter(entry.bbox);
    return Math.hypot((lng - center[0]) * kx, (lat - center[1]) * METERS_PER_DEGREE_LAT);
  };
  return manifest.chunks
    .filter((entry) => bboxesIntersect(entry.bbox, bounds))
    .sort((a, b) => distance(a) - distance(b));
}

/**
 * Cuadrado de suelo que se necesita para la vista actual: un círculo que
 * contiene el contenedor completo, agrandado por `margin` para cubrir lo que se
 * ve hacia el horizonte cuando el mapa está inclinado.
 */
export function viewportBounds(
  [lng, lat]: LngLat,
  metersPerPixel: number,
  widthPx: number,
  heightPx: number,
  margin: number,
): Bbox {
  const radiusM = (Math.hypot(widthPx, heightPx) / 2) * metersPerPixel * margin;
  const dLng = radiusM / metersPerDegreeLng(lat);
  const dLat = radiusM / METERS_PER_DEGREE_LAT;
  return [lng - dLng, lat - dLat, lng + dLng, lat + dLat];
}
