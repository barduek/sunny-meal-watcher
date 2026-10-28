import type { CustomLayerInterface, CustomRenderMethodInput, Map as MapLibreMap } from 'maplibre-gl';
import type { GeometryStore } from '../shadows/geometryStore';
import { multiplyMat4 } from '../shadows/gpuGeometry';
import { isDaytime, sunDirection } from '../shadows/lighting';
import { createCeilingGrid, ceilingExtent, SHADOW_BIAS_M, type LocalBounds } from '../shadows/shadowCeiling';
import type { SunPosition } from '../sun/sunPosition';
import { CeilingMap, type CeilingResult } from './ceilingMap';
import { linkProgram, toFloat32, uniformLocations } from './glUtils';
import { ATTR_CORNER, ATTR_EDGE, ATTR_HEIGHT, ATTR_ROOF, gpuChunk } from './gpuChunks';

export const BUILDINGS_LAYER_ID = 'buildings-3d';
const CREDIT_SOURCE_ID = 'buildings-credit';
const CREDIT_LAYER_ID = 'buildings-credit';

/**
 * Para leer el techo de sombra en una pared se sale 2,5 m hacia afuera: cerca de
 * la pared, las celdas de adentro valen casi la altura del edificio (su propio
 * contorno cuenta como un obstáculo "adelante") y contaminarían la lectura.
 */
const WALL_PROBE_M = 2.5;

// ---------------------------------------------------------------------------
// Shaders
// ---------------------------------------------------------------------------

const WALL_VERTEX_SHADER = `#version 300 es
layout(location = ${ATTR_CORNER}) in vec2 a_corner;
layout(location = ${ATTR_EDGE}) in vec4 a_edge;
layout(location = ${ATTR_HEIGHT}) in float a_height;
uniform mat4 u_matrix;
out vec3 v_normal;
out vec3 v_local;
void main() {
  vec2 a = a_edge.xy;
  vec2 b = a_edge.zw;
  vec2 e = b - a;
  // Los anillos van en sentido antihorario: la normal exterior de a → b es (dy, −dx).
  vec2 n = normalize(vec2(e.y, -e.x));
  vec2 xy = mix(a, b, a_corner.x);
  float z = a_corner.y * a_height;
  gl_Position = u_matrix * vec4(xy, z, 1.0);
  v_normal = vec3(n, 0.0);
  v_local = vec3(xy, z);
}`;

const ROOF_VERTEX_SHADER = `#version 300 es
layout(location = ${ATTR_ROOF}) in vec3 a_roof;
uniform mat4 u_matrix;
out vec3 v_normal;
out vec3 v_local;
void main() {
  gl_Position = u_matrix * vec4(a_roof, 1.0);
  v_normal = vec3(0.0, 0.0, 1.0);
  v_local = a_roof;
}`;

// Mismos colores que la leyenda: edificio #d9cfbf y sombra #27304a al 40%.
const FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec3 v_normal;
in vec3 v_local;
uniform vec3 u_sun;
uniform float u_daylight;
uniform float u_use_ceiling;
uniform float u_probe;
uniform float u_bias;
uniform sampler2D u_ceiling;
uniform vec2 u_center;
uniform vec2 u_axis_u;
uniform vec2 u_axis_v;
uniform float u_extent;
out vec4 fragColor;

const vec3 BASE = vec3(0.851, 0.812, 0.749);
const vec3 SHADOW_TINT = vec3(0.153, 0.188, 0.290);

// Techo de sombra en un punto del plano (0 fuera del mapa).
float ceilingAt(vec2 xy) {
  vec2 d = xy - u_center;
  vec2 uv = vec2(dot(d, u_axis_u), dot(d, u_axis_v)) / u_extent + 0.5;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 0.0;
  return texture(u_ceiling, uv).r;
}

void main() {
  vec3 n = normalize(v_normal);
  float ndl = dot(n, u_sun);

  // ¿Algún edificio le tapa el sol a este punto?
  float lit = 1.0;
  if (u_use_ceiling > 0.5) {
    float ceiling = ceilingAt(v_local.xy + n.xy * u_probe);
    lit = smoothstep(-0.1, 0.1, v_local.z + u_bias - ceiling);
  }

  // Recibe sol directo si mira hacia el sol, nada lo tapa y es de día.
  float facing = smoothstep(0.0, 0.2, ndl);
  float direct = u_daylight * facing * lit;

  // Luz de cielo, que no depende del sol (también de noche): los techos reciben más que las paredes, y las
  // paredes varían un poco según hacia dónde miran. Así se lee el volumen aunque todo esté a la sombra.
  float sky = 0.80 + 0.20 * n.z + 0.06 * dot(n.xy, vec2(-0.6, -0.8));
  float sun = 0.14 * clamp(ndl, 0.0, 1.0) * u_daylight;
  // Un techo al sol queda exactamente del color de la leyenda.
  vec3 color = BASE * min(sky + sun, 1.0);
  color = mix(color, SHADOW_TINT, 0.40 * (1.0 - direct));
  fragColor = vec4(color, 1.0);
}`;

const COMMON_UNIFORMS = [
  'u_matrix',
  'u_sun',
  'u_daylight',
  'u_use_ceiling',
  'u_probe',
  'u_bias',
  'u_ceiling',
  'u_center',
  'u_axis_u',
  'u_axis_v',
  'u_extent',
] as const;

type Uniforms = Record<(typeof COMMON_UNIFORMS)[number], WebGLUniformLocation | null>;

interface Resources {
  wallProgram: WebGLProgram;
  wallUniforms: Uniforms;
  roofProgram: WebGLProgram;
  roofUniforms: Uniforms;
  ceilingMap: CeilingMap | null;
}

// ---------------------------------------------------------------------------
// Capa
// ---------------------------------------------------------------------------

/**
 * Los edificios: paredes y techos dibujados con shaders propios, para poder
 * decidir pixel por pixel si el sol llega o lo tapa otro edificio. Las sombras
 * caen sobre techos y fachadas, no solo sobre el suelo.
 *
 * Si el navegador no puede calcular el techo de sombra (necesita dibujar en
 * texturas de punto flotante), los edificios se ven igual, solo que sin las
 * sombras que se tapan entre sí.
 */
export class BuildingsLayer implements CustomLayerInterface {
  readonly id = BUILDINGS_LAYER_ID;
  readonly type = 'custom';
  readonly renderingMode = '3d';

  private map: MapLibreMap | null = null;
  private res: Resources | null = null;
  private sun: SunPosition | null = null;
  private ceiling: CeilingResult | null = null;
  /** Qué sol y qué edificios se usaron en el último cálculo del techo de sombra. */
  private ceilingKey = '';

  /** `bounds` es el área que cubre el techo de sombra, en metros locales. */
  constructor(
    private readonly store: GeometryStore,
    private readonly bounds: LocalBounds,
  ) {}

  setSun(sun: SunPosition): void {
    this.sun = sun;
    this.map?.triggerRepaint();
  }

  onAdd(map: MapLibreMap, gl: WebGL2RenderingContext): void {
    this.map = map;
    const wallProgram = linkProgram(gl, WALL_VERTEX_SHADER, FRAGMENT_SHADER, 'Edificios (paredes)');
    const roofProgram = linkProgram(gl, ROOF_VERTEX_SHADER, FRAGMENT_SHADER, 'Edificios (techos)');

    const maxTexture = Math.min(4096, gl.getParameter(gl.MAX_TEXTURE_SIZE) as number);
    const ceilingMap = CeilingMap.tryCreate(gl, createCeilingGrid(this.bounds, maxTexture));
    if (!ceilingMap) {
      console.warn('Este navegador no puede dibujar en texturas de punto flotante: no se muestran las sombras sobre los edificios.');
    }

    this.res = {
      wallProgram,
      wallUniforms: uniformLocations(gl, wallProgram, COMMON_UNIFORMS),
      roofProgram,
      roofUniforms: uniformLocations(gl, roofProgram, COMMON_UNIFORMS),
      ceilingMap,
    };
  }

  onRemove(_map: MapLibreMap, gl: WebGL2RenderingContext): void {
    const res = this.res;
    if (res) {
      gl.deleteProgram(res.wallProgram);
      gl.deleteProgram(res.roofProgram);
      res.ceilingMap?.dispose(gl);
    }
    this.res = null;
    this.ceiling = null;
    this.map = null;
  }

  /** Recalcula el techo de sombra cuando cambia el sol o llegan edificios nuevos. */
  prerender(gl: WebGL2RenderingContext): void {
    const { res, sun } = this;
    if (!res?.ceilingMap || !sun) return;

    const key = `${this.store.version}|${sun.azimuth.toFixed(5)}|${sun.altitude.toFixed(5)}`;
    if (key === this.ceilingKey) return;
    this.ceilingKey = key;
    this.ceiling = res.ceilingMap.compute(gl, this.store, sun);
  }

  render(gl: WebGL2RenderingContext, args: CustomRenderMethodInput): void {
    const { res, sun, ceiling } = this;
    if (!res || this.store.chunks.length === 0) return;

    const matrix = toFloat32(multiplyMat4(args.defaultProjectionData.mainMatrix, this.store.model));
    const direction = sun ? sunDirection(sun) : ([0, 0, 1] as const);
    const daylight = sun && isDaytime(sun) ? 1 : 0;

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, ceiling?.texture ?? null);

    const bind = (program: WebGLProgram, uniforms: Uniforms) => {
      gl.useProgram(program);
      gl.uniformMatrix4fv(uniforms.u_matrix, false, matrix);
      gl.uniform3f(uniforms.u_sun, direction[0], direction[1], direction[2]);
      gl.uniform1f(uniforms.u_daylight, daylight);
      gl.uniform1f(uniforms.u_use_ceiling, ceiling ? 1 : 0);
      gl.uniform1f(uniforms.u_probe, WALL_PROBE_M);
      gl.uniform1f(uniforms.u_bias, SHADOW_BIAS_M);
      gl.uniform1i(uniforms.u_ceiling, 0);
      if (ceiling) {
        gl.uniform2f(uniforms.u_center, ceiling.grid.centerX, ceiling.grid.centerY);
        gl.uniform2f(uniforms.u_axis_u, ceiling.axes.u[0], ceiling.axes.u[1]);
        gl.uniform2f(uniforms.u_axis_v, ceiling.axes.v[0], ceiling.axes.v[1]);
        gl.uniform1f(uniforms.u_extent, ceilingExtent(ceiling.grid));
      }
    };

    bind(res.wallProgram, res.wallUniforms);
    for (const chunk of this.store.chunks) {
      const gpu = gpuChunk(gl, chunk);
      gl.bindVertexArray(gpu.wallVao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, gpu.edgeCount);
    }

    // En los techos la normal es vertical, así que `u_probe` no corre el punto donde se lee el techo de sombra.
    bind(res.roofProgram, res.roofUniforms);
    for (const chunk of this.store.chunks) {
      const gpu = gpuChunk(gl, chunk);
      gl.bindVertexArray(gpu.roofVao);
      gl.drawElements(gl.TRIANGLES, gpu.indexCount, gl.UNSIGNED_INT, 0);
    }

    gl.bindVertexArray(null);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }
}

// ---------------------------------------------------------------------------
// Mapa base y atribución
// ---------------------------------------------------------------------------

/** Oculta los edificios planos del mapa base: nuestra capa es la única fuente de edificios. */
export function hideBasemapBuildings(map: MapLibreMap): void {
  for (const layer of map.getStyle().layers) {
    if ('source-layer' in layer && layer['source-layer'] === 'building') {
      map.setLayoutProperty(layer.id, 'visibility', 'none');
    }
  }
}

/** Id de la primera capa de etiquetas, para dibujar los edificios por debajo de los nombres. */
export function firstSymbolLayerId(map: MapLibreMap): string | undefined {
  return map.getStyle().layers.find((layer) => layer.type === 'symbol')?.id;
}

/**
 * Muestra el crédito de la fuente de los edificios (HTML, obligatorio según su
 * licencia) en el control de atribución del mapa. MapLibre solo lista las
 * fuentes que usa alguna capa visible, así que va con una capa que no dibuja nada.
 */
export function addDataAttribution(map: MapLibreMap, attribution: string): void {
  map.addSource(CREDIT_SOURCE_ID, { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, attribution });
  map.addLayer({ id: CREDIT_LAYER_ID, type: 'circle', source: CREDIT_SOURCE_ID, paint: { 'circle-radius': 0 } });
}
