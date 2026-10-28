import { describe, expect, it } from 'vitest';
import { METERS_PER_DEGREE_LAT, metersPerDegreeLng, offsetLngLat, type LngLat } from '../geo/local';
import { MAX_SHADOW_LENGTH_M, projectShadow, shadowVector, signedAreaM2 } from './projectShadow';

const origin: LngLat = [-58.43, -34.588];

/** Anillo cerrado a partir de vértices en metros (este, norte) relativos a `origin`. */
function ringFromMeters(points: [number, number][]): LngLat[] {
  const ring = points.map(([east, north]) => offsetLngLat(origin, east, north));
  return [...ring, ring[0] as LngLat];
}

/** Cuadrado de 10 × 10 m con esquina suroeste en el origen. */
const square = ringFromMeters([
  [0, 0],
  [10, 0],
  [10, 10],
  [0, 10],
]);

function toMeters([lng, lat]: LngLat): [number, number] {
  return [(lng - origin[0]) * metersPerDegreeLng(origin[1]), (lat - origin[1]) * METERS_PER_DEGREE_LAT];
}

function pointInRing(point: LngLat, ring: LngLat[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 2; i < ring.length - 1; j = i++) {
    const [xi, yi] = ring[i] as LngLat;
    const [xj, yj] = ring[j] as LngLat;
    if (yi > point[1] !== yj > point[1] && point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const inShadow = (pieces: LngLat[][], east: number, north: number) =>
  pieces.some((piece) => pointInRing(offsetLngLat(origin, east, north), piece));

describe('shadowVector', () => {
  it('con el sol al norte a 45° la sombra mide lo mismo que la altura y va al sur', () => {
    const v = shadowVector(10, { azimuth: 0, altitude: 45 });
    expect(v?.east).toBeCloseTo(0, 9);
    expect(v?.north).toBeCloseTo(-10, 9);
  });

  it('con el sol al este la sombra va al oeste; a 30° mide √3 veces la altura', () => {
    const v = shadowVector(10, { azimuth: 90, altitude: 30 });
    expect(v?.east).toBeCloseTo(-10 * Math.sqrt(3), 9);
    expect(v?.north).toBeCloseTo(0, 9);
  });

  it('no hay sombra de noche ni para alturas nulas', () => {
    expect(shadowVector(10, { azimuth: 0, altitude: 0 })).toBeNull();
    expect(shadowVector(10, { azimuth: 0, altitude: -5 })).toBeNull();
    expect(shadowVector(0, { azimuth: 0, altitude: 45 })).toBeNull();
  });

  it('limita el largo con el sol casi en el horizonte', () => {
    const v = shadowVector(30, { azimuth: 270, altitude: 0.5 });
    expect(Math.hypot(v?.east ?? 0, v?.north ?? 0)).toBeCloseTo(MAX_SHADOW_LENGTH_M, 6);
  });
});

describe('projectShadow', () => {
  const sunNorth45 = { azimuth: 0, altitude: 45 };

  it('para un cuadrado con sol al norte a 45° cubre 10 m hacia el sur y nada al norte', () => {
    const pieces = projectShadow(square, 10, sunNorth45);
    expect(inShadow(pieces, 5, 5)).toBe(true); // debajo del edificio
    expect(inShadow(pieces, 5, -5)).toBe(true); // 5 m al sur
    expect(inShadow(pieces, 5, -9.5)).toBe(true);
    expect(inShadow(pieces, 5, -10.5)).toBe(false); // pasado el largo de la sombra
    expect(inShadow(pieces, 5, 12)).toBe(false); // del lado del sol
    expect(inShadow(pieces, 12, -5)).toBe(false); // al costado
  });

  it('ocupa exactamente la caja de 10 × 20 m y solo proyecta la arista del lado contrario al sol', () => {
    const pieces = projectShadow(square, 10, sunNorth45);
    // Huella + arista sur: la norte mira al sol y la este y la oeste son paralelas a la sombra.
    expect(pieces).toHaveLength(2);
    const meters = pieces.flat().map(toMeters);
    expect(Math.min(...meters.map(([e]) => e))).toBeCloseTo(0, 6);
    expect(Math.max(...meters.map(([e]) => e))).toBeCloseTo(10, 6);
    expect(Math.min(...meters.map(([, n]) => n))).toBeCloseTo(-10, 6);
    expect(Math.max(...meters.map(([, n]) => n))).toBeCloseTo(10, 6);
  });

  it('devuelve piezas cerradas y en sentido antihorario', () => {
    for (const piece of projectShadow(square, 10, { azimuth: 135, altitude: 30 })) {
      expect(piece[0]).toEqual(piece[piece.length - 1]);
      expect(signedAreaM2(piece)).toBeGreaterThan(0);
    }
  });

  it('respeta huellas cóncavas: no sombrea el hueco de una L del lado del sol', () => {
    // L de 20 × 20 m sin el cuadrante noreste; sol al sur (azimut 180) muy alto → sombra corta hacia el norte.
    const lShape = ringFromMeters([
      [0, 0],
      [20, 0],
      [20, 10],
      [10, 10],
      [10, 20],
      [0, 20],
    ]);
    const pieces = projectShadow(lShape, 3, { azimuth: 180, altitude: 60 }); // ~1,7 m de sombra
    expect(inShadow(pieces, 15, 11)).toBe(true); // justo al norte del ala sur
    expect(inShadow(pieces, 15, 15)).toBe(false); // hueco de la L: una envolvente convexa lo taparía
  });

  it('da la misma sombra aunque la huella venga en sentido horario', () => {
    const clockwise = [...square].reverse();
    const sun = { azimuth: 200, altitude: 35 };
    const probe = (pieces: LngLat[][]) =>
      [
        [5, 5],
        [8, 20],
        [5, 15],
        [-3, 12],
        [12, 12],
      ].map(([east, north]) => inShadow(pieces, east as number, north as number));
    expect(probe(projectShadow(clockwise, 10, sun))).toEqual(probe(projectShadow(square, 10, sun)));
  });

  it('de noche no hay sombra', () => {
    expect(projectShadow(square, 10, { azimuth: 0, altitude: -1 })).toEqual([]);
  });
});
