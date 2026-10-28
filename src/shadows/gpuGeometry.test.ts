import { describe, expect, it } from 'vitest';
import type { Building } from '../buildings/types';
import { offsetLngLat, type LngLat } from '../geo/local';
import {
  FLOATS_PER_EDGE,
  buildEdgeInstances,
  createLocalFrame,
  localToMercatorMatrix,
  mercatorX,
  mercatorY,
  multiplyMat4,
  toLocalMeters,
} from './gpuGeometry';

const center: LngLat = [-58.4303, -34.5889];
const frame = createLocalFrame(center);

/** Aplica una matriz column-major a un punto (x, y, 0, 1). */
function apply(m: ArrayLike<number>, x: number, y: number): [number, number] {
  const w = (m[3] as number) * x + (m[7] as number) * y + (m[15] as number);
  return [
    ((m[0] as number) * x + (m[4] as number) * y + (m[12] as number)) / w,
    ((m[1] as number) * x + (m[5] as number) * y + (m[13] as number)) / w,
  ];
}

describe('sistema local', () => {
  it('pone el origen en el centro y mide en metros hacia el este y el norte', () => {
    expect(toLocalMeters(frame, center)).toEqual([0, 0]);
    const [east, north] = toLocalMeters(frame, offsetLngLat(center, 100, -50));
    // Tolerancia por la diferencia entre el radio terrestre de MapLibre y el de offsetLngLat (~0,1%).
    expect(east).toBeCloseTo(100, 0);
    expect(north).toBeCloseTo(-50, 0);
  });

  it('la matriz local → Mercator devuelve las coordenadas Mercator originales', () => {
    const point = offsetLngLat(center, 250, 120);
    const [x, y] = apply(localToMercatorMatrix(frame), ...toLocalMeters(frame, point));
    expect(x).toBeCloseTo(mercatorX(point[0]), 12);
    expect(y).toBeCloseTo(mercatorY(point[1]), 12);
  });
});

describe('multiplyMat4', () => {
  it('multiplicar por la identidad no cambia la matriz', () => {
    const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const m = localToMercatorMatrix(frame);
    expect(Array.from(multiplyMat4(identity, m))).toEqual(Array.from(m));
  });

  it('compone en el orden a × b (primero b)', () => {
    const translate = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 20, 0, 1];
    const scale = [2, 0, 0, 0, 0, 3, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    expect(apply(multiplyMat4(translate, scale), 1, 1)).toEqual([12, 23]);
  });
});

describe('buildEdgeInstances', () => {
  /** Cuadrado de 10 m definido en sentido horario, para probar que se reorienta. */
  const clockwise: LngLat[] = [
    center,
    offsetLngLat(center, 0, 10),
    offsetLngLat(center, 10, 10),
    offsetLngLat(center, 10, 0),
    center,
  ];
  const building: Building = { id: 'x', footprint: clockwise, height: 12, heightSource: 'height' };

  it('carga una instancia por arista con su altura', () => {
    const data = buildEdgeInstances([building], frame);
    expect(data.length).toBe(4 * FLOATS_PER_EDGE);
    for (let i = 0; i < 4; i++) expect(data[i * FLOATS_PER_EDGE + 4]).toBe(12);
  });

  it('reorienta los anillos a sentido antihorario', () => {
    const data = buildEdgeInstances([building], frame);
    let twiceArea = 0;
    for (let i = 0; i < data.length; i += FLOATS_PER_EDGE) {
      twiceArea += (data[i] as number) * (data[i + 3] as number) - (data[i + 2] as number) * (data[i + 1] as number);
    }
    expect(twiceArea).toBeGreaterThan(0);
  });

  it('descarta aristas de largo cero', () => {
    const withDuplicate = { ...building, footprint: [clockwise[0] as LngLat, ...clockwise] };
    expect(buildEdgeInstances([withDuplicate], frame).length).toBe(4 * FLOATS_PER_EDGE);
  });
});
