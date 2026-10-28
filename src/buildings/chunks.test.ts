import type { Feature, Polygon } from 'geojson';
import { describe, expect, it } from 'vitest';
import { METERS_PER_DEGREE_LAT, metersPerDegreeLng, type Bbox, type LngLat } from '../geo/local';
import {
  MANIFEST_VERSION,
  buildManifest,
  chunkCellBbox,
  chunkCellOf,
  chunkId,
  chunksInBounds,
  createChunkGrid,
  isChunkManifest,
  splitIntoChunks,
  unionBounds,
  viewportBounds,
  type ChunkEntry,
  type DataSourceInfo,
} from './chunks';

const AREA: Bbox = [-58.445, -34.598, -58.419, -34.579];
const grid = createChunkGrid(AREA, 500);
const source: DataSourceInfo = { name: 'Prueba', url: 'https://example.com', license: 'CC BY', attribution: 'Prueba' };

/** Cuadrado de ~10 m con esquina sudoeste en (lng, lat). */
function building(lng: number, lat: number): Feature<Polygon> {
  const d = 0.0001;
  return {
    type: 'Feature',
    properties: { height: 9 },
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [lng, lat],
          [lng + d, lat],
          [lng + d, lat + d],
          [lng, lat + d],
          [lng, lat],
        ],
      ],
    },
  };
}

describe('grilla de zonas', () => {
  it('numera las zonas desde la esquina sudoeste del área', () => {
    expect(chunkCellOf(grid, [AREA[0] + 0.0001, AREA[1] + 0.0001])).toEqual({ x: 0, y: 0 });
  });

  it('avanza una zona cada 500 m hacia el este y hacia el norte', () => {
    const east = AREA[0] + 510 / metersPerDegreeLng(grid.refLat);
    const north = AREA[1] + 1020 / METERS_PER_DEGREE_LAT;
    expect(chunkCellOf(grid, [east, AREA[1]])).toEqual({ x: 1, y: 0 });
    expect(chunkCellOf(grid, [AREA[0], north])).toEqual({ x: 0, y: 2 });
  });

  it('la caja de una zona mide 500 m de lado y contiene los puntos que le tocan', () => {
    const cell = { x: 2, y: 3 };
    const [west, south, east, north] = chunkCellBbox(grid, cell);
    expect((east - west) * metersPerDegreeLng(grid.refLat)).toBeCloseTo(500, 6);
    expect((north - south) * METERS_PER_DEGREE_LAT).toBeCloseTo(500, 6);
    const inside: LngLat = [(west + east) / 2, (south + north) / 2];
    expect(chunkCellOf(grid, inside)).toEqual(cell);
  });

  it('arma el id con la posición de la zona', () => {
    expect(chunkId({ x: 2, y: -1 })).toBe('2_-1');
  });
});

describe('splitIntoChunks', () => {
  it('pone cada edificio en una sola zona, según el centro de su caja', () => {
    const near = building(AREA[0] + 0.0005, AREA[1] + 0.0005);
    const sameZone = building(AREA[0] + 0.001, AREA[1] + 0.001);
    const farEast = building(AREA[0] + 0.022, AREA[1] + 0.0005); // ~2.017 m al este → cuarta zona

    const groups = splitIntoChunks([near, sameZone, farEast], grid);

    expect([...groups.keys()].sort()).toEqual(['0_0', '4_0']);
    expect(groups.get('0_0')?.features).toEqual([near, sameZone]);
    expect(groups.get('4_0')?.features).toEqual([farEast]);
  });

  it('un edificio cortado por el borde del área queda en una sola zona', () => {
    const straddling = building(AREA[0] - 0.00005, AREA[1] + 0.0005);
    const groups = splitIntoChunks([straddling], grid);
    expect([...groups.values()].flatMap((group) => group.features)).toEqual([straddling]);
  });
});

describe('unionBounds', () => {
  it('devuelve la caja que contiene a todos los edificios', () => {
    const bounds = unionBounds([building(-58.43, -34.59), building(-58.42, -34.585)]);
    expect(bounds?.[0]).toBeCloseTo(-58.43, 9);
    expect(bounds?.[1]).toBeCloseTo(-34.59, 9);
    expect(bounds?.[2]).toBeCloseTo(-58.4199, 9);
    expect(bounds?.[3]).toBeCloseTo(-34.5849, 9);
  });

  it('devuelve null si no hay edificios', () => {
    expect(unionBounds([])).toBeNull();
  });
});

describe('buildManifest', () => {
  const entries: ChunkEntry[] = [
    { id: '1_0', file: 'tiles/1_0.geojson', bbox: [0, 0, 1, 1], count: 5 },
    { id: '0_0', file: 'tiles/0_0.geojson', bbox: [0, 0, 1, 1], count: 7 },
  ];

  it('ordena las zonas por id y suma el total de edificios', () => {
    const manifest = buildManifest({
      area: 'palermo',
      bbox: AREA,
      chunkSizeM: 500,
      source,
      dataVersion: 'abc123',
      generatedAt: '2026-10-19T00:00:00.000Z',
      chunks: entries,
    });
    expect(manifest.version).toBe(MANIFEST_VERSION);
    expect(manifest.total).toBe(12);
    expect(manifest.chunks.map((chunk) => chunk.id)).toEqual(['0_0', '1_0']);
  });
});

describe('isChunkManifest', () => {
  const valid = buildManifest({
    area: 'palermo',
    bbox: AREA,
    chunkSizeM: 500,
    source,
    dataVersion: 'abc123',
    generatedAt: '2026-10-19T00:00:00.000Z',
    chunks: [{ id: '0_0', file: 'tiles/0_0.geojson', bbox: AREA, count: 3 }],
  });

  it('acepta un índice bien formado, también después de pasar por JSON', () => {
    expect(isChunkManifest(valid)).toBe(true);
    expect(isChunkManifest(JSON.parse(JSON.stringify(valid)))).toBe(true);
  });

  it('rechaza otras versiones del formato y datos que no son un índice', () => {
    expect(isChunkManifest({ ...valid, version: 99 })).toBe(false);
    expect(isChunkManifest({ ...valid, chunks: [{ id: '0_0' }] })).toBe(false);
    expect(isChunkManifest({ ...valid, source: undefined })).toBe(false);
    expect(isChunkManifest('<!doctype html>')).toBe(false);
    expect(isChunkManifest(null)).toBe(false);
  });
});

describe('chunksInBounds', () => {
  const chunk = (id: string, bbox: Bbox): ChunkEntry => ({ id, file: `tiles/${id}.geojson`, bbox, count: 1 });
  const manifest = {
    chunks: [
      chunk('far', [-58.41, -34.6, -58.4, -34.59]),
      chunk('west', [-58.44, -34.595, -58.43, -34.585]),
      chunk('middle', [-58.43, -34.595, -58.42, -34.585]),
    ],
  };

  it('deja afuera las zonas que no tocan la vista', () => {
    const ids = chunksInBounds(manifest, [-58.445, -34.6, -58.419, -34.58], [-58.425, -34.59]).map((c) => c.id);
    expect(ids).not.toContain('far');
  });

  it('ordena de la zona más cercana al centro a la más lejana', () => {
    const wide: Bbox = [-58.45, -34.61, -58.39, -34.58];
    expect(chunksInBounds(manifest, wide, [-58.425, -34.59]).map((c) => c.id)).toEqual(['middle', 'west', 'far']);
    expect(chunksInBounds(manifest, wide, [-58.405, -34.595]).map((c) => c.id)).toEqual(['far', 'middle', 'west']);
  });

  it('una zona que apenas roza la vista cuenta como visible', () => {
    const touching: Bbox = [-58.42, -34.59, -58.41, -34.58];
    expect(chunksInBounds(manifest, touching, [-58.415, -34.585]).map((c) => c.id)).toContain('middle');
  });
});

describe('viewportBounds', () => {
  it('es un cuadrado centrado en la vista, con radio = media diagonal × margen', () => {
    const center: LngLat = [-58.4303, -34.5889];
    const [west, south, east, north] = viewportBounds(center, 1, 600, 800, 1.5);
    const radius = 500 * 1.5; // media diagonal de 600×800 = 500 px
    expect(((east - west) / 2) * metersPerDegreeLng(center[1])).toBeCloseTo(radius, 6);
    expect(((north - south) / 2) * METERS_PER_DEGREE_LAT).toBeCloseTo(radius, 6);
    expect((west + east) / 2).toBeCloseTo(center[0], 9);
    expect((south + north) / 2).toBeCloseTo(center[1], 9);
  });
});
