import type { Feature, Geometry } from 'geojson';
import { describe, expect, it } from 'vitest';
import { normalizeFeatureCollection } from './normalize';
import { tejidoToBuildingFeature, type TejidoProperties } from './gcba';
import type { Bbox } from './overpass';

const PALERMO_BBOX: Bbox = [-58.445, -34.598, -58.419, -34.579];

/** Volumen como viene en tejido.geojson: MultiPolygon con coordenadas de 15 decimales. */
function tejido(properties: TejidoProperties, lng = -58.4303, lat = -34.5889): Feature<Geometry, TejidoProperties> {
  const d = 0.0001;
  return {
    type: 'Feature',
    properties,
    geometry: {
      type: 'MultiPolygon',
      coordinates: [
        [
          [
            [lng + 0.000000123456789, lat],
            [lng + d, lat],
            [lng + d, lat + d],
            [lng, lat + d],
            [lng + 0.000000123456789, lat],
          ],
        ],
      ],
    },
  };
}

describe('tejidoToBuildingFeature', () => {
  it('toma la altura en metros, arma el id y simplifica la geometría', () => {
    const feature = tejidoToBuildingFeature(tejido({ id: 1758328, altura: 12.34 }), PALERMO_BBOX);
    expect(feature?.id).toBe('gcba/1758328');
    expect(feature?.properties).toEqual({ height: 12.3 });
    expect(feature?.geometry.type).toBe('Polygon');
    // Coordenadas redondeadas a 6 decimales.
    expect(feature?.geometry.coordinates[0]?.[0]).toEqual([-58.4303, -34.5889]);
  });

  it('descarta volúmenes fuera del bbox', () => {
    expect(tejidoToBuildingFeature(tejido({ id: 1, altura: 6 }, -58.5169, -34.6195), PALERMO_BBOX)).toBeNull();
  });

  it('descarta volúmenes sin altura válida', () => {
    expect(tejidoToBuildingFeature(tejido({ id: 1, altura: 0 }), PALERMO_BBOX)).toBeNull();
    expect(tejidoToBuildingFeature(tejido({ id: 1 }), PALERMO_BBOX)).toBeNull();
  });

  it('queda listo para el normalizador de la app con la altura del GCBA', () => {
    const feature = tejidoToBuildingFeature(tejido({ id: 7, altura: 25.2 }), PALERMO_BBOX);
    const [building] = normalizeFeatureCollection({ type: 'FeatureCollection', features: feature ? [feature] : [] });
    expect(building).toMatchObject({ id: 'gcba/7', height: 25.2, heightSource: 'height' });
  });
});
