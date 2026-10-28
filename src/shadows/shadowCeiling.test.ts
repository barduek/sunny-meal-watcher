import { describe, expect, it } from 'vitest';
import type { SunPosition } from '../sun/sunPosition';
import {
  CEILING_CELL_M,
  ceilingAt,
  ceilingAxes,
  ceilingExtent,
  ceilingPasses,
  computeCeilingCpu,
  createCeilingGrid,
  fromCeilingUv,
  isLit,
  sampleField,
  toCeilingUv,
  type CeilingAxes,
} from './shadowCeiling';

const DEG = Math.PI / 180;

/** Edificio rectangular alineado con los ejes, en metros locales. */
interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  h: number;
}

/** Zona de 120 × 120 m con celdas de 1 m (el mapa cuadrado mide 170 celdas por lado). */
const grid = createCeilingGrid({ minX: 0, minY: 0, maxX: 120, maxY: 120 }, 4096, 1);

/** Altura de los edificios en cada celda del mapa girado (por el centro de la celda). */
function rasterize(boxes: Box[], axes: CeilingAxes): Float32Array {
  const heights = new Float32Array(grid.size * grid.size);
  for (let j = 0; j < grid.size; j++) {
    for (let i = 0; i < grid.size; i++) {
      const [x, y] = fromCeilingUv(grid, axes, (i + 0.5) / grid.size, (j + 0.5) / grid.size);
      for (const b of boxes) {
        if (x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1) heights[j * grid.size + i] = Math.max(heights[j * grid.size + i] ?? 0, b.h);
      }
    }
  }
  return heights;
}

/** Techo de sombra calculado con las pasadas en CPU. */
function ceilingFor(boxes: Box[], sun: SunPosition, maxHeight: number): { ceiling: Float32Array; axes: CeilingAxes } {
  const axes = ceilingAxes(sun);
  return { ceiling: computeCeilingCpu(rasterize(boxes, axes), grid.size, ceilingPasses(sun, grid, maxHeight)), axes };
}

/**
 * Valor exacto de S para edificios rectangulares: lanza el rayo hacia el sol y
 * toma el primer punto del rayo (t > 0) que cae dentro de un edificio.
 */
function analyticCeiling(boxes: Box[], x: number, y: number, sun: SunPosition): number {
  const sx = Math.sin(sun.azimuth * DEG);
  const sy = Math.cos(sun.azimuth * DEG);
  const tan = Math.tan(sun.altitude * DEG);
  let best = 0;

  for (const b of boxes) {
    // Método de las "losas": intervalo de t donde el rayo está dentro del rectángulo.
    let tIn = -Infinity;
    let tOut = Infinity;
    for (const [origin, dir, lo, hi] of [
      [x, sx, b.x0, b.x1],
      [y, sy, b.y0, b.y1],
    ] as const) {
      if (Math.abs(dir) < 1e-12) {
        if (origin < lo || origin > hi) tIn = Infinity;
      } else {
        const t1 = (lo - origin) / dir;
        const t2 = (hi - origin) / dir;
        tIn = Math.max(tIn, Math.min(t1, t2));
        tOut = Math.min(tOut, Math.max(t1, t2));
      }
    }
    if (tIn <= tOut && tOut > 0) best = Math.max(best, b.h - Math.max(tIn, 0) * tan);
  }
  return Math.max(best, 0);
}

describe('createCeilingGrid', () => {
  it('es un cuadrado centrado en la zona, con lado igual a su diagonal', () => {
    const g = createCeilingGrid({ minX: -1000, minY: -500, maxX: 1000, maxY: 500 });
    const diagonal = Math.hypot(2000, 1000);
    expect(g.cell).toBe(CEILING_CELL_M);
    expect(g.size).toBe(Math.ceil(diagonal / CEILING_CELL_M));
    expect(ceilingExtent(g)).toBeGreaterThanOrEqual(diagonal);
    expect([g.centerX, g.centerY]).toEqual([0, 0]);
  });

  it('agranda las celdas si no entra en una textura', () => {
    const g = createCeilingGrid({ minX: 0, minY: 0, maxX: 10_000, maxY: 4_000 }, 4096);
    expect(g.size).toBeLessThanOrEqual(4096);
    expect(g.cell).toBeGreaterThan(CEILING_CELL_M);
  });
});

describe('ejes del mapa', () => {
  it('v apunta al sol y u es perpendicular', () => {
    for (const azimuth of [0, 45, 90, 135, 200, 286, 359]) {
      const { u, v } = ceilingAxes({ azimuth, altitude: 30 });
      expect(v[0]).toBeCloseTo(Math.sin(azimuth * DEG), 9);
      expect(v[1]).toBeCloseTo(Math.cos(azimuth * DEG), 9);
      expect(u[0] * v[0] + u[1] * v[1]).toBeCloseTo(0, 9);
      expect(Math.hypot(u[0], u[1])).toBeCloseTo(1, 9);
    }
  });

  it('pasar a coordenadas de textura y volver da la misma posición', () => {
    const axes = ceilingAxes({ azimuth: 233, altitude: 20 });
    for (const [x, y] of [[10, 20], [60, 60], [119, 3]] as const) {
      const [u, v] = toCeilingUv(grid, axes, x, y);
      const [bx, by] = fromCeilingUv(grid, axes, u, v);
      expect(bx).toBeCloseTo(x, 6);
      expect(by).toBeCloseTo(y, 6);
    }
  });

  it('el centro de la zona cae en el centro de la textura', () => {
    expect(toCeilingUv(grid, ceilingAxes({ azimuth: 77, altitude: 10 }), 60, 60)).toEqual([0.5, 0.5]);
  });

  it('cualquier punto de la zona entra en la textura, para cualquier azimut', () => {
    for (let azimuth = 0; azimuth < 360; azimuth += 15) {
      const axes = ceilingAxes({ azimuth, altitude: 30 });
      for (const [x, y] of [[0, 0], [120, 0], [0, 120], [120, 120]] as const) {
        const [u, v] = toCeilingUv(grid, axes, x, y);
        expect(u).toBeGreaterThanOrEqual(0);
        expect(u).toBeLessThanOrEqual(1);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('ceilingPasses', () => {
  it('de noche o sin edificios no hay pasadas', () => {
    expect(ceilingPasses({ azimuth: 0, altitude: -5 }, grid, 30)).toEqual([]);
    expect(ceilingPasses({ azimuth: 0, altitude: 0 }, grid, 30)).toEqual([]);
    expect(ceilingPasses({ azimuth: 0, altitude: 40 }, grid, 0)).toEqual([]);
  });

  it('la primera lee las alturas y el desplazamiento se duplica: 1, 1, 2, 4…', () => {
    const passes = ceilingPasses({ azimuth: 90, altitude: 10 }, grid, 100);
    expect(passes[0]?.first).toBe(true);
    expect(passes.slice(1).every((p) => !p.first)).toBe(true);
    expect(passes.slice(0, 6).map((p) => p.offset)).toEqual([1, 1, 2, 4, 8, 16]);
  });

  it('la caída es proporcional al desplazamiento y a tan(altura del sol)', () => {
    const passes = ceilingPasses({ azimuth: 10, altitude: 30 }, grid, 50);
    for (const pass of passes) expect(pass.drop).toBeCloseTo(pass.offset * grid.cell * Math.tan(30 * DEG), 9);
  });

  it('con el sol bajo llegan más lejos (más pasadas) que con el sol alto', () => {
    const low = ceilingPasses({ azimuth: 90, altitude: 8 }, grid, 50).length;
    const high = ceilingPasses({ azimuth: 90, altitude: 60 }, grid, 50).length;
    expect(low).toBeGreaterThan(high);
  });

  it('alcanza para cubrir la sombra más larga posible', () => {
    const passes = ceilingPasses({ azimuth: 200, altitude: 20 }, grid, 100);
    const covered = 2 ** (passes.length - 1) * grid.cell;
    expect(covered).toBeGreaterThanOrEqual(100 / Math.tan(20 * DEG)); // 275 m
  });
});

describe('computeCeilingCpu', () => {
  // Una torre de 30 m y un edificio bajo de 10 m, separados.
  const boxes: Box[] = [
    { x0: 40, y0: 40, x1: 50, y1: 50, h: 30 },
    { x0: 70, y0: 60, x1: 85, y1: 75, h: 10 },
  ];

  const sunCases: [string, SunPosition][] = [
    ['sol al este a 30°', { azimuth: 90, altitude: 30 }],
    ['sol al norte a 45°', { azimuth: 0, altitude: 45 }],
    ['sol al oeste a 20°', { azimuth: 270, altitude: 20 }],
    ['sol al sudeste a 35°', { azimuth: 135, altitude: 35 }],
    ['sol al noroeste a 25°', { azimuth: 315, altitude: 25 }],
    ['sol al ENE a 12°', { azimuth: 70, altitude: 12 }],
    ['sol al SSO a 50°', { azimuth: 200, altitude: 50 }],
  ];

  for (const [name, sun] of sunCases) {
    it(`coincide con el cálculo exacto con ${name}, también en diagonal`, () => {
      const { ceiling, axes } = ceilingFor(boxes, sun, 30);
      // La sombra puede correrse hasta ~1,6 celdas por la discretización: en altura, eso es 1,6 · celda · tan(altura del sol).
      const tolerance = 1.6 * grid.cell * Math.tan(sun.altitude * DEG) + 0.05;

      // Perpendicular al rayo: sirve para detectar los puntos pegados al borde lateral de una sombra.
      const px = Math.cos(sun.azimuth * DEG);
      const py = -Math.sin(sun.azimuth * DEG);

      let compared = 0;
      let inShadow = 0;
      for (let x = 4.5; x < 120; x += 3) {
        for (let y = 4.5; y < 120; y += 3) {
          // Pegados a un edificio (o adentro) manda la discretización de la grilla.
          if (boxes.some((b) => x > b.x0 - 2 && x < b.x1 + 2 && y > b.y0 - 2 && y < b.y1 + 2)) continue;

          const expected = analyticCeiling(boxes, x, y, sun);
          // Junto al borde lateral de una sombra el valor salta de 0 a la altura entera por una diferencia mínima: no sirve para comparar.
          const left = analyticCeiling(boxes, x + 1.5 * px, y + 1.5 * py, sun);
          const right = analyticCeiling(boxes, x - 1.5 * px, y - 1.5 * py, sun);
          if (Math.abs(left - expected) > tolerance || Math.abs(right - expected) > tolerance) continue;

          const actual = ceilingAt(ceiling, grid, axes, x, y);
          expect(Math.abs(actual - expected), `(${x}, ${y}): esperado ${expected.toFixed(2)}, obtenido ${actual.toFixed(2)}`).toBeLessThan(tolerance);
          compared += 1;
          if (expected > 0.5) inShadow += 1;
        }
      }
      // Que la comparación no pase "vacía": hay muchos puntos con sombra y muchos sin ella.
      expect(compared).toBeGreaterThan(400);
      expect(inShadow).toBeGreaterThan(20);
    });
  }

  it('detrás de la torre el techo baja en rampa: altura − distancia × tan(altura del sol)', () => {
    // Sol al este a 30°: la sombra de la torre cae hacia el oeste (x menor).
    const sun = { azimuth: 90, altitude: 30 };
    const { ceiling, axes } = ceilingFor(boxes, sun, 30);
    const at = (x: number) => ceilingAt(ceiling, grid, axes, x, 45);
    const tan = Math.tan(30 * DEG);

    expect(at(30)).toBeCloseTo(30 - 10 * tan, 0); // a 10 m del borde oeste de la torre
    expect(at(20)).toBeCloseTo(30 - 20 * tan, 0);
    expect(at(10)).toBeCloseTo(30 - 30 * tan, 0);
    expect(at(30) - at(20)).toBeCloseTo(10 * tan, 1); // pendiente = tan(altura del sol)
  });

  it('la rampa mantiene su pendiente también con el sol en diagonal (sin difuminarse)', () => {
    // Sol al sudeste a 35°: a lo largo del rayo, cada 10 m el techo baja 10 · tan(35°).
    const sun = { azimuth: 135, altitude: 35 };
    const { ceiling, axes } = ceilingFor(boxes, sun, 30);
    const tan = Math.tan(35 * DEG);
    // Puntos sobre el rayo que sale del centro de la torre hacia el noroeste (opuesto al sol): (45 − k, 45 + k).
    const along = (k: number) => ceilingAt(ceiling, grid, axes, 45 - k * 0.7071, 45 + k * 0.7071);
    expect(along(25) - along(35)).toBeCloseTo(10 * tan, 0);
    expect(along(35) - along(45)).toBeCloseTo(10 * tan, 0);
  });

  it('del lado del sol de la torre no hay sombra', () => {
    const sun = { azimuth: 90, altitude: 30 };
    const { ceiling, axes } = ceilingFor(boxes, sun, 30);
    expect(ceilingAt(ceiling, grid, axes, 60, 45)).toBeLessThan(0.5);
  });

  it('el techo de un edificio bajo queda a la sombra de una torre que le tapa el sol', () => {
    // Sol al oeste a 25°: la torre (x 40–50) está entre el sol y el edificio bajo (x 70–85).
    const sun = { azimuth: 270, altitude: 25 };
    const scene: Box[] = [
      { x0: 40, y0: 40, x1: 50, y1: 70, h: 30 },
      { x0: 70, y0: 50, x1: 85, y1: 65, h: 10 },
    ];
    const { ceiling, axes } = ceilingFor(scene, sun, 30);

    // Desde el centro del techo (75, 57) hay 25 m hasta la torre: el rayo del sol pasa a 25·tan(25°) ≈ 11,7 m de altura sobre el techo y la torre mide 30 m.
    const value = ceilingAt(ceiling, grid, axes, 75, 57);
    expect(value).toBeCloseTo(30 - 25 * Math.tan(25 * DEG), 0);
    expect(isLit(value, 10)).toBe(false); // el techo del edificio bajo (10 m) está a la sombra
    expect(isLit(value, 25)).toBe(true); // un punto más alto que la sombra sí recibe sol
  });

  it('un edificio al sur con el sol al norte no le hace sombra al de enfrente', () => {
    const sun = { azimuth: 0, altitude: 40 };
    const scene: Box[] = [
      { x0: 40, y0: 20, x1: 60, y1: 30, h: 20 }, // al sur
      { x0: 40, y0: 60, x1: 60, y1: 70, h: 20 }, // al norte
    ];
    const { ceiling, axes } = ceilingFor(scene, sun, 20);
    // El sol está al norte: el edificio del norte tapa la zona entre ambos, no al revés.
    expect(ceilingAt(ceiling, grid, axes, 50, 45)).toBeCloseTo(20 - 15 * Math.tan(40 * DEG), 0);
    expect(ceilingAt(ceiling, grid, axes, 50, 75)).toBeLessThan(0.5);
  });
});

describe('isLit', () => {
  it('un punto está al sol si no queda por debajo del techo de sombra', () => {
    expect(isLit(12, 15)).toBe(true);
    expect(isLit(12, 5)).toBe(false);
    expect(isLit(0, 0)).toBe(true);
  });

  it('tolera un margen chico para que un techo no se tape a sí mismo', () => {
    expect(isLit(10.05, 10)).toBe(true);
    expect(isLit(10.5, 10)).toBe(false);
  });
});

describe('sampleField', () => {
  const field = new Float32Array([0, 10, 0, 10]); // 2 × 2

  it('interpola entre los centros de las celdas', () => {
    expect(sampleField(field, 2, 0.25, 0.25)).toBeCloseTo(0, 9); // centro de la celda 0
    expect(sampleField(field, 2, 0.75, 0.25)).toBeCloseTo(10, 9); // centro de la celda 1
    expect(sampleField(field, 2, 0.5, 0.25)).toBeCloseTo(5, 9); // a mitad de camino
  });

  it('fuera del mapa vale 0', () => {
    expect(sampleField(field, 2, -0.1, 0.5)).toBe(0);
    expect(sampleField(field, 2, 0.5, 1.1)).toBe(0);
  });
});
