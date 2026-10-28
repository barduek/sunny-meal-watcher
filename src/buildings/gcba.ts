import type { Feature, Geometry, MultiPolygon, Polygon, Position } from 'geojson';
import type { Bbox } from '../geo/local';
import type { DataSourceInfo } from './chunks';
import { parsePositiveNumber } from './normalize';

const DATASET_URL = 'https://data.buenosaires.gob.ar/dataset/tejido-urbano';

/**
 * Dataset "Tejido Urbano" del GCBA (BA Data): cada feature es un volumen
 * edificado con altura uniforme en metros, relevado por fotogrametría (datos
 * hasta 2021, coordenadas en lng/lat). Un edificio puede tener varios volúmenes
 * de distinta altura, que funcionan bien como prismas separados.
 */
export const TEJIDO_URBANO = {
  downloadUrl:
    'https://cdn.buenosaires.gob.ar/datosabiertos/datasets/secretaria-de-desarrollo-urbano/tejido-urbano/tejido.geojson',
  source: {
    name: 'Tejido Urbano del GCBA (2021)',
    url: DATASET_URL,
    license: 'CC BY 4.0',
    attribution: `Edificios: <a href="${DATASET_URL}" target="_blank" rel="noopener">GCBA – Tejido Urbano</a> (CC BY 4.0)`,
  } satisfies DataSourceInfo,
};

export interface TejidoProperties {
  id?: number | string;
  /** Altura del volumen en metros. */
  altura?: number | string;
}

export type TejidoBuildingFeature = Feature<Polygon | MultiPolygon, { height: number }>;

/** 6 decimales ≈ 11 cm: sobra para prismas y achica el archivo. */
const round6 = (value: number): number => Math.round(value * 1e6) / 1e6;

function roundRing(ring: Position[]): Position[] {
  return ring.map(([lng, lat]) => [round6(lng as number), round6(lat as number)]);
}

/** Solo los anillos exteriores (los patios internos no se usan en el MVP). */
function outerRings(geometry: Geometry | null): Position[][] {
  if (geometry?.type === 'Polygon') return geometry.coordinates[0] ? [geometry.coordinates[0]] : [];
  if (geometry?.type === 'MultiPolygon') return geometry.coordinates.flatMap((polygon) => (polygon[0] ? [polygon[0]] : []));
  return [];
}

function intersectsBbox(rings: Position[][], [west, south, east, north]: Bbox): boolean {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const ring of rings) {
    for (const [x, y] of ring) {
      minX = Math.min(minX, x as number);
      maxX = Math.max(maxX, x as number);
      minY = Math.min(minY, y as number);
      maxY = Math.max(maxY, y as number);
    }
  }
  return maxX >= west && minX <= east && maxY >= south && minY <= north;
}

/**
 * Convierte un volumen del Tejido Urbano al formato de edificios de la app
 * (`height` en metros). Devuelve null si cae fuera del bbox o no tiene altura válida.
 */
export function tejidoToBuildingFeature(feature: Feature<Geometry | null, TejidoProperties | null>, bbox: Bbox): TejidoBuildingFeature | null {
  const rings = outerRings(feature.geometry).filter((ring) => ring.length >= 4);
  const height = parsePositiveNumber(feature.properties?.altura);
  if (rings.length === 0 || height === null || !intersectsBbox(rings, bbox)) return null;

  const [first] = rings;
  return {
    type: 'Feature',
    id: `gcba/${feature.properties?.id ?? feature.id ?? 'sin-id'}`,
    properties: { height: Math.round(height * 10) / 10 },
    geometry:
      rings.length === 1 && first
        ? { type: 'Polygon', coordinates: [roundRing(first)] }
        : { type: 'MultiPolygon', coordinates: rings.map((ring) => [roundRing(ring)]) },
  };
}
