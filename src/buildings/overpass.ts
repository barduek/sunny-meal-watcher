import type { Feature, FeatureCollection, MultiPolygon, Polygon } from 'geojson';
import type { Bbox } from '../geo/local';
import type { DataSourceInfo } from './chunks';
import type { LngLat } from './types';

export type { Bbox };

/** Datos de OpenStreetMap: cómo se presentan al usuario y qué licencia piden. */
export const OSM_SOURCE: DataSourceInfo = {
  name: 'OpenStreetMap',
  url: 'https://www.openstreetmap.org/copyright',
  license: 'ODbL 1.0',
  attribution:
    '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
};

interface OverpassPoint {
  lat: number;
  lon: number;
}

interface OverpassMember {
  type: string;
  ref: number;
  role: string;
  geometry?: OverpassPoint[];
}

export interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  tags?: Record<string, string>;
  geometry?: OverpassPoint[];
  members?: OverpassMember[];
}

export interface OverpassResponse {
  elements: OverpassElement[];
  osm3s?: { timestamp_osm_base?: string };
  /** Overpass informa acá timeouts o errores de ejecución (a veces con datos parciales). */
  remark?: string;
}

/** Tags que se guardan en el snapshot: el resto no se usa y solo agranda el archivo. */
export const KEPT_TAGS = ['building', 'height', 'building:levels'] as const;

/** Valores de `building` que no son un volumen macizo (techos sueltos, "no es edificio"). */
const SKIPPED_BUILDING_VALUES = new Set(['no', 'roof']);

export type BuildingFeature = Feature<Polygon | MultiPolygon, Record<string, string>>;

/** Query Overpass QL: edificios (ways y multipolígonos) dentro del bbox, con geometría. */
export function buildOverpassQuery([west, south, east, north]: Bbox, timeoutSeconds = 90): string {
  const box = `${south},${west},${north},${east}`;
  return (
    `[out:json][timeout:${timeoutSeconds}];` +
    `(way["building"](${box});relation["building"]["type"="multipolygon"](${box}););` +
    'out geom;'
  );
}

/** 7 decimales (~1 cm): la misma precisión con la que OSM guarda las coordenadas. */
const round7 = (value: number): number => Math.round(value * 1e7) / 1e7;

function toLngLat(points: OverpassPoint[]): LngLat[] {
  return points.map(({ lat, lon }) => [round7(lon), round7(lat)]);
}

const samePoint = (a: LngLat | undefined, b: LngLat | undefined): boolean =>
  a !== undefined && b !== undefined && a[0] === b[0] && a[1] === b[1];

const isClosedRing = (ring: LngLat[]): boolean => ring.length >= 4 && samePoint(ring[0], ring[ring.length - 1]);

/**
 * Une tramos abiertos (los ways de una relación) en anillos cerrados.
 * Como un anillo válido es un ciclo, alcanza con ir extendiéndolo por su final.
 * Lo que no llega a cerrar se descarta.
 */
export function assembleRings(parts: LngLat[][]): LngLat[][] {
  const pending = parts.filter((part) => part.length >= 2).map((part) => [...part]);
  const rings: LngLat[][] = [];

  while (pending.length > 0) {
    let ring = pending.shift() as LngLat[];
    let extended = true;
    while (!isClosedRing(ring) && extended) {
      extended = false;
      const end = ring[ring.length - 1];
      const index = pending.findIndex((part) => samePoint(part[0], end) || samePoint(part[part.length - 1], end));
      if (index === -1) break;
      const [next] = pending.splice(index, 1) as [LngLat[]];
      const oriented = samePoint(next[0], end) ? next : [...next].reverse();
      ring = ring.concat(oriented.slice(1));
      extended = true;
    }
    if (isClosedRing(ring)) rings.push(ring);
  }
  return rings;
}

function pickTags(tags: Record<string, string>): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const key of KEPT_TAGS) {
    const value = tags[key];
    if (value !== undefined) kept[key] = value;
  }
  return kept;
}

function elementRings(element: OverpassElement): LngLat[][] {
  if (element.type === 'way' && element.geometry) {
    const ring = toLngLat(element.geometry);
    return isClosedRing(ring) ? [ring] : [];
  }
  if (element.type === 'relation' && element.members) {
    const outerParts = element.members
      .filter((member) => member.role === 'outer' && member.geometry && member.geometry.length > 0)
      .map((member) => toLngLat(member.geometry as OverpassPoint[]));
    return assembleRings(outerParts);
  }
  return [];
}

/**
 * Convierte la respuesta de Overpass en GeoJSON con un feature por edificio.
 * Guarda solo los anillos exteriores: los patios internos no se usan en el MVP.
 */
export function overpassToGeoJSON(response: OverpassResponse): FeatureCollection<Polygon | MultiPolygon, Record<string, string>> {
  const features: BuildingFeature[] = [];

  for (const element of response.elements) {
    const tags = element.tags ?? {};
    const buildingValue = tags['building'];
    if (!buildingValue || SKIPPED_BUILDING_VALUES.has(buildingValue)) continue;

    const rings = elementRings(element);
    const [firstRing] = rings;
    if (!firstRing) continue;

    features.push({
      type: 'Feature',
      id: `${element.type}/${element.id}`,
      properties: pickTags(tags),
      geometry:
        rings.length === 1
          ? { type: 'Polygon', coordinates: [firstRing] }
          : { type: 'MultiPolygon', coordinates: rings.map((ring) => [ring]) },
    });
  }

  return { type: 'FeatureCollection', features };
}
