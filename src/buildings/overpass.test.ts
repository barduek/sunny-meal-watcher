import { describe, expect, it } from 'vitest';
import { normalizeFeatureCollection } from './normalize';
import { assembleRings, buildOverpassQuery, overpassToGeoJSON, type OverpassElement } from './overpass';
import type { LngLat } from './types';

/** Cuadrado de ~10 m con esquina en (lon, lat), con coordenadas ya redondeadas a 7 decimales. */
function squareGeometry(lon = -58.43, lat = -34.588) {
  const d = 0.0001;
  const r = (value: number) => Math.round(value * 1e7) / 1e7;
  return [
    { lat, lon },
    { lat, lon: r(lon + d) },
    { lat: r(lat + d), lon: r(lon + d) },
    { lat: r(lat + d), lon },
    { lat, lon },
  ];
}

function way(id: number, tags: Record<string, string>, geometry = squareGeometry()): OverpassElement {
  return { type: 'way', id, tags, geometry };
}

describe('buildOverpassQuery', () => {
  it('usa el orden sur,oeste,norte,este que espera Overpass', () => {
    const query = buildOverpassQuery([-58.445, -34.598, -58.419, -34.579]);
    expect(query).toContain('way["building"](-34.598,-58.445,-34.579,-58.419)');
    expect(query).toContain('relation["building"]["type"="multipolygon"](-34.598,-58.445,-34.579,-58.419)');
    expect(query).toContain('out geom;');
  });
});

describe('assembleRings', () => {
  const a: LngLat = [0, 0];
  const b: LngLat = [1, 0];
  const c: LngLat = [1, 1];
  const d: LngLat = [0, 1];

  it('une tramos consecutivos aunque vengan invertidos', () => {
    const rings = assembleRings([
      [a, b, c],
      [a, d, c], // invertido: termina donde termina el primero
    ]);
    expect(rings).toEqual([[a, b, c, d, a]]);
  });

  it('descarta tramos que no llegan a cerrar', () => {
    expect(assembleRings([[a, b, c]])).toEqual([]);
  });
});

describe('overpassToGeoJSON', () => {
  it('convierte un way cerrado en Polygon y conserva solo los tags útiles', () => {
    const collection = overpassToGeoJSON({
      elements: [way(1, { building: 'yes', height: '25', name: 'Algo', 'addr:street': 'Honduras' })],
    });
    expect(collection.features).toHaveLength(1);
    const [feature] = collection.features;
    expect(feature?.id).toBe('way/1');
    expect(feature?.properties).toEqual({ building: 'yes', height: '25' });
    expect(feature?.geometry.type).toBe('Polygon');
  });

  it('descarta ways abiertos y valores de building que no son volúmenes', () => {
    const open = squareGeometry().slice(0, 4);
    const collection = overpassToGeoJSON({
      elements: [way(1, { building: 'yes' }, open), way(2, { building: 'no' }), way(3, { building: 'roof' })],
    });
    expect(collection.features).toEqual([]);
  });

  it('arma el contorno de una relación partida en tramos', () => {
    const square = squareGeometry();
    const relation: OverpassElement = {
      type: 'relation',
      id: 7,
      tags: { type: 'multipolygon', building: 'school' },
      members: [
        { type: 'way', ref: 1, role: 'outer', geometry: square.slice(0, 3) },
        { type: 'way', ref: 2, role: 'outer', geometry: square.slice(2) },
      ],
    };
    const [feature] = overpassToGeoJSON({ elements: [relation] }).features;
    expect(feature?.id).toBe('relation/7');
    expect(feature?.geometry).toEqual({
      type: 'Polygon',
      coordinates: [square.map(({ lat, lon }) => [lon, lat])],
    });
  });

  it('genera un MultiPolygon si la relación tiene varios contornos cerrados', () => {
    const relation: OverpassElement = {
      type: 'relation',
      id: 8,
      tags: { type: 'multipolygon', building: 'yes' },
      members: [
        { type: 'way', ref: 1, role: 'outer', geometry: squareGeometry() },
        { type: 'way', ref: 2, role: 'outer', geometry: squareGeometry(-58.42) },
        { type: 'way', ref: 3, role: 'inner', geometry: squareGeometry(-58.41) },
      ],
    };
    const [feature] = overpassToGeoJSON({ elements: [relation] }).features;
    expect(feature?.geometry.type).toBe('MultiPolygon');
    expect(feature?.geometry.coordinates).toHaveLength(2);
  });
});

describe('Overpass → edificios normalizados', () => {
  it('resuelve la altura con height, con pisos o con el valor por defecto', () => {
    const collection = overpassToGeoJSON({
      elements: [
        way(1, { building: 'apartments', height: '25', 'building:levels': '8' }),
        way(2, { building: 'house', 'building:levels': '4' }),
        way(3, { building: 'yes' }),
      ],
    });
    const buildings = normalizeFeatureCollection(collection);
    expect(buildings.map(({ id, height, heightSource }) => ({ id, height, heightSource }))).toEqual([
      { id: 'way/1', height: 25, heightSource: 'height' },
      { id: 'way/2', height: 12, heightSource: 'levels' },
      { id: 'way/3', height: 9, heightSource: 'default' },
    ]);
  });
});
