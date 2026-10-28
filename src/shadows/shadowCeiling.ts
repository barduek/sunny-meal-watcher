import type { SunPosition } from '../sun/sunPosition';

/**
 * "Techo de sombra" (shadow ceiling).
 *
 * Para cada punto (x, y) del plano, `S(x, y)` es la altura por debajo de la
 * cual un punto queda a la sombra de algún edificio:
 *
 *   S(x, y) = máx sobre t > 0 de [ H(x + t·sx, y + t·sy) − t·tan(altura del sol) ]
 *
 * donde `H` es la altura del edificio en cada posición, (sx, sy) es la
 * dirección horizontal hacia el sol y `t` la distancia en metros. Un rayo que
 * sale de un punto a altura `z` hacia el sol queda tapado si algún edificio a
 * distancia `t` es más alto que el rayo (z + t·tan), o sea si z < S.
 *
 * Con esa sola cantidad se resuelve si un punto está al sol, sea el suelo, un
 * techo o una pared: se lee `S` en su posición y se compara con su altura. Y como
 * `S` baja en rampa lineal al alejarse del edificio, el borde de la sombra
 * queda nítido aunque la grilla sea gruesa.
 *
 * El mapa está girado: su eje v apunta siempre hacia el sol. Así, buscar el
 * edificio que tapa el sol es recorrer una columna de celdas, y cada pasada es
 * un desplazamiento entero (sin interpolar, que difuminaría el resultado). Se
 * hace en la GPU con pasadas que duplican el alcance (1, 2, 4… celdas): en
 * cada una, `M ← máx(M, M desplazado − caída)`. Este archivo tiene la parte
 * pura, y una versión en CPU de las mismas pasadas, que sirve de referencia.
 */

const DEG = Math.PI / 180;

/** Lado de cada celda del mapa de sombras, en metros. */
export const CEILING_CELL_M = 1.25;

/** Hasta dónde se busca un edificio que tape el sol. A 15° de altura, uno de 100 m da sombra de 370 m. */
export const MAX_CEILING_REACH_M = 640;

/** Tolerancia al comparar la altura de un punto con el techo de sombra (m). */
export const SHADOW_BIAS_M = 0.1;

/** Rectángulo en metros locales (este, norte). */
export interface LocalBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Mapa cuadrado que cubre la zona sea cual sea hacia dónde mire el sol: su lado
 * es la diagonal de la zona. Se reutiliza la misma textura para todas las horas.
 */
export interface CeilingGrid {
  /** Centro de la zona, en metros locales. */
  centerX: number;
  centerY: number;
  /** Celdas por lado. */
  size: number;
  /** Lado de cada celda (m). */
  cell: number;
}

/** Si con el tamaño preferido de celda no entraría en una textura, se agranda la celda: menos detalle antes que fallar. */
export function createCeilingGrid(
  bounds: LocalBounds,
  maxTextureSize = 4096,
  preferredCell = CEILING_CELL_M,
): CeilingGrid {
  const diagonal = Math.hypot(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
  const cell = Math.max(preferredCell, diagonal / maxTextureSize);
  return {
    centerX: (bounds.minX + bounds.maxX) / 2,
    centerY: (bounds.minY + bounds.maxY) / 2,
    size: Math.max(1, Math.ceil(diagonal / cell)),
    cell,
  };
}

/** Ejes del mapa para un sol dado, en (este, norte): v crece hacia el sol y u es perpendicular. */
export interface CeilingAxes {
  u: [number, number];
  v: [number, number];
}

export function ceilingAxes({ azimuth }: SunPosition): CeilingAxes {
  const sx = Math.sin(azimuth * DEG);
  const sy = Math.cos(azimuth * DEG);
  return { u: [sy, -sx], v: [sx, sy] };
}

/** Lado del mapa en metros. */
export const ceilingExtent = (grid: CeilingGrid): number => grid.size * grid.cell;

/** Posición en metros locales → coordenadas de textura (0..1). */
export function toCeilingUv(grid: CeilingGrid, axes: CeilingAxes, x: number, y: number): [number, number] {
  const extent = ceilingExtent(grid);
  const dx = x - grid.centerX;
  const dy = y - grid.centerY;
  return [(dx * axes.u[0] + dy * axes.u[1]) / extent + 0.5, (dx * axes.v[0] + dy * axes.v[1]) / extent + 0.5];
}

/** Coordenadas de textura (0..1) → posición en metros locales. Inversa de `toCeilingUv`. */
export function fromCeilingUv(grid: CeilingGrid, axes: CeilingAxes, u: number, v: number): [number, number] {
  const extent = ceilingExtent(grid);
  const du = (u - 0.5) * extent;
  const dv = (v - 0.5) * extent;
  return [grid.centerX + du * axes.u[0] + dv * axes.v[0], grid.centerY + du * axes.u[1] + dv * axes.v[1]];
}

/** Una pasada de la propagación. */
export interface CeilingPass {
  /** La primera lee las alturas de los edificios; las demás, el resultado de la pasada anterior. */
  first: boolean;
  /** Cuántas celdas hacia el sol se mira (un número entero). */
  offset: number;
  /** Cuánto baja el rayo del sol en ese desplazamiento (m). */
  drop: number;
}

/**
 * Pasadas necesarias para el sol dado. Cada una duplica el alcance de la
 * anterior, así que alcanzan ~log2(alcance / celda) + 1. Vacío si es de noche o
 * no hay edificios.
 */
export function ceilingPasses(
  sun: SunPosition,
  grid: CeilingGrid,
  maxHeight: number,
  maxReach = MAX_CEILING_REACH_M,
): CeilingPass[] {
  if (sun.altitude <= 0 || maxHeight <= 0) return [];

  const tanAltitude = Math.tan(sun.altitude * DEG);
  // Un edificio de altura máxima da sombra de largo maxHeight / tan; más lejos no hace falta mirar.
  const reach = Math.min(maxReach, maxHeight / tanAltitude);
  const last = Math.max(0, Math.ceil(Math.log2(reach / grid.cell)));

  return Array.from({ length: last + 1 }, (_, index) => {
    // Las pasadas 0 y 1 miran una celda; después se duplica: 2, 4, 8…
    const offset = index === 0 ? 1 : 2 ** (index - 1);
    return { first: index === 0, offset, drop: offset * grid.cell * tanAltitude };
  });
}

/** Muestrea un campo cuadrado con interpolación bilineal; fuera del mapa vale 0. (u, v) en 0..1. */
export function sampleField(field: Float32Array, size: number, u: number, v: number): number {
  if (u < 0 || u > 1 || v < 0 || v > 1) return 0;
  const fx = u * size - 0.5;
  const fy = v * size - 0.5;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const at = (i: number, j: number): number =>
    field[Math.min(Math.max(j, 0), size - 1) * size + Math.min(Math.max(i, 0), size - 1)] ?? 0;
  const bottom = at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx;
  const top = at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx;
  return bottom * (1 - ty) + top * ty;
}

/** Techo de sombra en un punto de coordenadas locales (m). */
export function ceilingAt(ceiling: Float32Array, grid: CeilingGrid, axes: CeilingAxes, x: number, y: number): number {
  const [u, v] = toCeilingUv(grid, axes, x, y);
  return sampleField(ceiling, grid.size, u, v);
}

/** Un punto a altura `z` está al sol si no queda por debajo del techo de sombra. */
export function isLit(ceiling: number, z: number): boolean {
  return z + SHADOW_BIAS_M >= ceiling;
}

/**
 * Las mismas pasadas que hace la GPU, en CPU. `heights` trae la altura del
 * edificio en cada celda del mapa girado (0 donde no hay), fila por fila.
 */
export function computeCeilingCpu(heights: Float32Array, size: number, passes: CeilingPass[]): Float32Array {
  let previous = heights;

  for (const pass of passes) {
    const next = new Float32Array(size * size);
    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        const here = pass.first ? 0 : (previous[j * size + i] ?? 0);
        const target = j + pass.offset;
        const ahead = target < size ? (previous[target * size + i] ?? 0) - pass.drop : 0;
        next[j * size + i] = Math.max(here, ahead, 0);
      }
    }
    previous = next;
  }
  return previous;
}
