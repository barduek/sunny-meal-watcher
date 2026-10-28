import { describe, expect, it } from 'vitest';
import type { Building } from '../buildings/types';
import { offsetLngLat, type Bbox, type LngLat } from '../geo/local';
import { FLOATS_PER_EDGE } from './gpuGeometry';
import { GeometryStore, areaLocalBounds, buildChunkGeometry } from './geometryStore';
import { FLOATS_PER_ROOF_VERTEX } from './roofMesh';

const origin: LngLat = [-58.4303, -34.5889];

function building(east: number, north: number, size: number, height: number): Building {
  const corners: [number, number][] = [
    [east, north],
    [east + size, north],
    [east + size, north + size],
    [east, north + size],
  ];
  const ring = corners.map(([e, n]) => offsetLngLat(origin, e, n));
  return { id: `${east}_${north}`, footprint: [...ring, ring[0] as LngLat], height, heightSource: 'height' };
}

describe('GeometryStore', () => {
  it('arranca vacío', () => {
    const store = new GeometryStore(origin);
    expect(store.chunks).toHaveLength(0);
    expect(store.version).toBe(0);
    expect(store.maxHeight).toBe(0);
  });

  it('cada zona suma aristas y techos, y cambia la versión', () => {
    const store = new GeometryStore(origin);

    expect(store.add([building(0, 0, 10, 12), building(30, 0, 10, 25)])).toBe(true);
    expect(store.version).toBe(1);
    expect(store.maxHeight).toBe(25);

    expect(store.add([building(100, 100, 10, 40)])).toBe(true);
    expect(store.version).toBe(2);
    expect(store.maxHeight).toBe(40);
    expect(store.chunks).toHaveLength(2);
  });

  it('una zona vacía no cambia nada', () => {
    const store = new GeometryStore(origin);
    expect(store.add([])).toBe(false);
    expect(store.version).toBe(0);
    expect(store.chunks).toHaveLength(0);
  });
});

describe('buildChunkGeometry', () => {
  it('un edificio cuadrado tiene 4 aristas, 4 vértices de techo y 2 triángulos', () => {
    const store = new GeometryStore(origin);
    const chunk = buildChunkGeometry([building(0, 0, 10, 12)], store.frame);
    expect(chunk?.edgeCount).toBe(4);
    expect(chunk?.edges.length).toBe(4 * FLOATS_PER_EDGE);
    expect(chunk?.roofVertices.length).toBe(4 * FLOATS_PER_ROOF_VERTEX);
    expect(chunk?.roofIndices.length).toBe(6);
    expect(chunk?.maxHeight).toBe(12);
  });
});

describe('areaLocalBounds', () => {
  const store = new GeometryStore(origin);

  it('el centro del área queda cerca del origen y los lados miden lo que mide el bbox', () => {
    const bbox: Bbox = [-58.445, -34.598, -58.419, -34.579];
    const { minX, minY, maxX, maxY } = areaLocalBounds(store.frame, bbox);
    expect(maxX - minX).toBeGreaterThan(2300);
    expect(maxX - minX).toBeLessThan(2500);
    expect(maxY - minY).toBeGreaterThan(2000);
    expect(maxY - minY).toBeLessThan(2200);
    expect(minX).toBeLessThan(0);
    expect(maxX).toBeGreaterThan(0);
  });

  it('el margen agranda el área hacia todos los lados', () => {
    const bbox: Bbox = [-58.445, -34.598, -58.419, -34.579];
    const plain = areaLocalBounds(store.frame, bbox);
    const padded = areaLocalBounds(store.frame, bbox, 60);
    expect(padded.minX).toBeCloseTo(plain.minX - 60, 9);
    expect(padded.maxY).toBeCloseTo(plain.maxY + 60, 9);
  });
});
