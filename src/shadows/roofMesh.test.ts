import { describe, expect, it } from 'vitest';
import type { Building } from '../buildings/types';
import { offsetLngLat, type LngLat } from '../geo/local';
import { createLocalFrame } from './gpuGeometry';
import { FLOATS_PER_ROOF_VERTEX, buildRoofMesh } from './roofMesh';

const origin: LngLat = [-58.4303, -34.5889];
const frame = createLocalFrame(origin);

/** Edificio a partir de vértices en metros (este, norte) relativos al origen. */
function building(points: [number, number][], height: number, id = 'x'): Building {
  const ring = points.map(([east, north]) => offsetLngLat(origin, east, north));
  return { id, footprint: [...ring, ring[0] as LngLat], height, heightSource: 'height' };
}

/**
 * Las áreas coinciden salvo ~0,2%: el test arma las huellas con `offsetLngLat` (111.320 m por grado)
 * y el sistema local usa el radio terrestre de MapLibre (111.195 m por grado).
 */
function expectArea(actual: number, expected: number): void {
  expect(Math.abs(actual / expected - 1)).toBeLessThan(0.01);
}

/** Suma de las áreas de los triángulos de la malla (m²). */
function meshArea(vertices: Float32Array, indices: Uint32Array): number {
  let area = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const [a, b, c] = [indices[i], indices[i + 1], indices[i + 2]].map((index) => (index as number) * FLOATS_PER_ROOF_VERTEX);
    const [ax, ay] = [vertices[a as number], vertices[(a as number) + 1]];
    const [bx, by] = [vertices[b as number], vertices[(b as number) + 1]];
    const [cx, cy] = [vertices[c as number], vertices[(c as number) + 1]];
    area += Math.abs(((bx as number) - (ax as number)) * ((cy as number) - (ay as number)) - ((cx as number) - (ax as number)) * ((by as number) - (ay as number))) / 2;
  }
  return area;
}

describe('buildRoofMesh', () => {
  it('un cuadrado de 10 × 10 m son 4 vértices y 2 triángulos que suman 100 m²', () => {
    const { vertices, indices } = buildRoofMesh(
      [building([[0, 0], [10, 0], [10, 10], [0, 10]], 12)],
      frame,
    );
    expect(vertices.length / FLOATS_PER_ROOF_VERTEX).toBe(4);
    expect(indices.length).toBe(6);
    expectArea(meshArea(vertices, indices), 100);
  });

  it('cada vértice lleva la altura del edificio', () => {
    const { vertices } = buildRoofMesh([building([[0, 0], [10, 0], [10, 10], [0, 10]], 12)], frame);
    for (let i = 2; i < vertices.length; i += FLOATS_PER_ROOF_VERTEX) expect(vertices[i]).toBe(12);
  });

  it('una huella en L cubre solo su superficie: 300 m², no los 400 m² de su caja', () => {
    const l = building([[0, 0], [20, 0], [20, 10], [10, 10], [10, 20], [0, 20]], 9);
    const { vertices, indices } = buildRoofMesh([l], frame);
    expectArea(meshArea(vertices, indices), 300);
  });

  it('sin importar el sentido del anillo', () => {
    const clockwise = building([[0, 10], [10, 10], [10, 0], [0, 0]], 9);
    const { vertices, indices } = buildRoofMesh([clockwise], frame);
    expectArea(meshArea(vertices, indices), 100);
  });

  it('los índices de cada edificio apuntan a sus propios vértices', () => {
    const first = building([[0, 0], [10, 0], [10, 10], [0, 10]], 6, 'a');
    const second = building([[50, 0], [60, 0], [60, 10], [50, 10]], 20, 'b');
    const { vertices, indices } = buildRoofMesh([first, second], frame);

    expect(vertices.length / FLOATS_PER_ROOF_VERTEX).toBe(8);
    expect(Math.max(...indices)).toBe(7);
    // Los 6 últimos índices (segundo edificio) usan los vértices 4 a 7, con altura 20.
    for (const index of Array.from(indices).slice(6)) {
      expect(index).toBeGreaterThanOrEqual(4);
      expect(vertices[index * FLOATS_PER_ROOF_VERTEX + 2]).toBe(20);
    }
  });

  it('ignora huellas degeneradas y listas vacías', () => {
    const line = building([[0, 0], [10, 0]], 9);
    expect(buildRoofMesh([line], frame).indices.length).toBe(0);
    expect(buildRoofMesh([], frame).vertices.length).toBe(0);
  });
});
