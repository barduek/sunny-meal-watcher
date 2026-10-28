import type { Feature, FeatureCollection, GeoJsonProperties, Geometry, Position } from 'geojson';
import type { Building, HeightSource, LngLat } from './types';

/** Altura aproximada por piso (valor de referencia de la wiki de OSM). */
export const METERS_PER_LEVEL = 3;

/** Altura para edificios sin ningún dato (~3 pisos). */
export const DEFAULT_HEIGHT_M = 9;

/**
 * Interpreta números o textos del estilo "12", "12 m" o "12,5".
 * Devuelve null si el valor no es un número positivo.
 */
export function parsePositiveNumber(value: unknown): number | null {
  let parsed: number;
  if (typeof value === 'number') {
    parsed = value;
  } else if (typeof value === 'string') {
    parsed = Number.parseFloat(value.trim().replace(',', '.'));
  } else {
    return null;
  }
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/** Resuelve la altura con fallback: `height` → `building:levels` × 3 m → valor por defecto. */
export function resolveHeight(properties: GeoJsonProperties): { height: number; heightSource: HeightSource } {
  const height = parsePositiveNumber(properties?.['height']);
  if (height !== null) return { height, heightSource: 'height' };

  const levels = parsePositiveNumber(properties?.['building:levels']);
  if (levels !== null) return { height: levels * METERS_PER_LEVEL, heightSource: 'levels' };

  return { height: DEFAULT_HEIGHT_M, heightSource: 'default' };
}

/** Deja el anillo en [lng, lat], lo cierra y lo descarta si no llega a formar un polígono. */
function toFootprint(ring: Position[] | undefined): LngLat[] | null {
  if (!ring) return null;

  const points: LngLat[] = [];
  for (const [lng, lat] of ring) {
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
    points.push([lng as number, lat as number]);
  }

  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return null;
  if (first[0] !== last[0] || first[1] !== last[1]) points.push([first[0], first[1]]);

  // Un anillo cerrado necesita al menos 3 vértices distintos + el de cierre.
  return points.length >= 4 ? points : null;
}

/**
 * Convierte un Feature GeoJSON (Polygon o MultiPolygon) en edificios.
 * Usa solo el anillo exterior de cada polígono: en el MVP se ignoran los patios internos.
 */
export function featureToBuildings(feature: Feature<Geometry | null>, fallbackId: string): Building[] {
  const { geometry } = feature;
  const polygons =
    geometry?.type === 'Polygon' ? [geometry.coordinates] : geometry?.type === 'MultiPolygon' ? geometry.coordinates : [];

  const baseId = String(feature.id ?? feature.properties?.['id'] ?? fallbackId);
  const { height, heightSource } = resolveHeight(feature.properties);

  const buildings: Building[] = [];
  polygons.forEach((rings, index) => {
    const footprint = toFootprint(rings[0]);
    if (!footprint) return;
    const id = polygons.length > 1 ? `${baseId}#${index}` : baseId;
    buildings.push({ id, footprint, height, heightSource });
  });
  return buildings;
}

/** Normaliza una FeatureCollection completa (snapshot de OSM o archivo cargado a mano). */
export function normalizeFeatureCollection(collection: FeatureCollection<Geometry | null>): Building[] {
  return collection.features.flatMap((feature, index) => featureToBuildings(feature, `edificio-${index}`));
}
