import type { Feature, Geometry } from 'geojson';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_HEIGHT_M,
  featureToBuildings,
  normalizeFeatureCollection,
  parsePositiveNumber,
  resolveHeight,
} from './normalize';

const square: [number, number][] = [
  [-58.43, -34.588],
  [-58.4299, -34.588],
  [-58.4299, -34.5879],
  [-58.43, -34.5879],
  [-58.43, -34.588],
];

function polygonFeature(properties: Record<string, unknown>, ring = square): Feature<Geometry> {
  return { type: 'Feature', id: 'way/1', properties, geometry: { type: 'Polygon', coordinates: [ring] } };
}

describe('parsePositiveNumber', () => {
  it('acepta números y textos con unidad o coma decimal', () => {
    expect(parsePositiveNumber(12)).toBe(12);
    expect(parsePositiveNumber('12 m')).toBe(12);
    expect(parsePositiveNumber('12,5')).toBe(12.5);
  });

  it('descarta valores vacíos, no numéricos, cero o negativos', () => {
    expect(parsePositiveNumber(undefined)).toBeNull();
    expect(parsePositiveNumber('')).toBeNull();
    expect(parsePositiveNumber('unknown')).toBeNull();
    expect(parsePositiveNumber(0)).toBeNull();
    expect(parsePositiveNumber('-3')).toBeNull();
    expect(parsePositiveNumber(Number.NaN)).toBeNull();
  });
});

describe('resolveHeight', () => {
  it('prioriza la altura explícita', () => {
    expect(resolveHeight({ height: '25', 'building:levels': '4' })).toEqual({ height: 25, heightSource: 'height' });
  });

  it('usa los pisos × 3 m si no hay altura', () => {
    expect(resolveHeight({ 'building:levels': '4' })).toEqual({ height: 12, heightSource: 'levels' });
  });

  it('cae a pisos si la altura es inválida', () => {
    expect(resolveHeight({ height: 'alto', 'building:levels': 3 })).toEqual({ height: 9, heightSource: 'levels' });
  });

  it('usa la altura por defecto si no hay ningún dato', () => {
    expect(resolveHeight({})).toEqual({ height: DEFAULT_HEIGHT_M, heightSource: 'default' });
    expect(resolveHeight(null)).toEqual({ height: DEFAULT_HEIGHT_M, heightSource: 'default' });
  });
});

describe('featureToBuildings', () => {
  it('convierte un Polygon en un edificio con su id y altura', () => {
    const [building] = featureToBuildings(polygonFeature({ height: 15 }), 'fallback');
    expect(building).toEqual({ id: 'way/1', footprint: square, height: 15, heightSource: 'height' });
  });

  it('cierra anillos abiertos y descarta coordenadas de altura (z)', () => {
    const open = square.slice(0, 4).map(([lng, lat]) => [lng, lat, 5]) as unknown as [number, number][];
    const [building] = featureToBuildings(polygonFeature({}, open), 'fallback');
    expect(building?.footprint).toEqual(square);
  });

  it('genera un edificio por parte de un MultiPolygon', () => {
    const feature: Feature<Geometry> = {
      type: 'Feature',
      id: 'relation/9',
      properties: { 'building:levels': 2 },
      geometry: { type: 'MultiPolygon', coordinates: [[square], [square]] },
    };
    expect(featureToBuildings(feature, 'fallback').map((b) => b.id)).toEqual(['relation/9#0', 'relation/9#1']);
  });

  it('ignora geometrías que no son polígonos o anillos degenerados', () => {
    const point: Feature<Geometry> = {
      type: 'Feature',
      properties: {},
      geometry: { type: 'Point', coordinates: [-58.43, -34.588] },
    };
    expect(featureToBuildings(point, 'fallback')).toEqual([]);
    expect(featureToBuildings(polygonFeature({}, square.slice(0, 2)), 'fallback')).toEqual([]);
  });
});

describe('normalizeFeatureCollection', () => {
  it('usa un id de respaldo cuando el feature no trae uno', () => {
    const feature = polygonFeature({ height: 6 });
    delete feature.id;
    const buildings = normalizeFeatureCollection({ type: 'FeatureCollection', features: [feature] });
    expect(buildings.map((b) => b.id)).toEqual(['edificio-0']);
  });
});
