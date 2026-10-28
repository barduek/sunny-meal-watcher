import {
  MercatorCoordinate,
  type CustomLayerInterface,
  type CustomRenderMethodInput,
  type Map as MapLibreMap,
} from 'maplibre-gl';
import { metersPerPixel, type LngLat } from '../geo/local';
import { sunDomePoint } from '../sun/dome';
import type { SunPosition } from '../sun/sunPosition';

/** Radio de la cúpula como fracción del alto visible: el sol queda siempre a mano en pantalla. */
const DOME_RADIUS_FACTOR = 0.35;
/** Tamaños en pixeles CSS. */
const SUN_SIZE_PX = 56;
const PATH_DOT_SIZE_PX = 7;

const VERTEX_SHADER = `#version 300 es
uniform mat4 u_matrix;
uniform float u_size;
in vec3 a_pos;
void main() {
  gl_Position = u_matrix * vec4(a_pos, 1.0);
  gl_PointSize = u_size;
}`;

// Cada punto es un disco con borde suave; el sol además tiene un halo.
const FRAGMENT_SHADER = `#version 300 es
precision mediump float;
uniform vec4 u_core;
uniform vec4 u_halo;
uniform float u_core_radius;
out vec4 fragColor;
void main() {
  float d = length(gl_PointCoord - vec2(0.5)) * 2.0;
  if (d > 1.0) discard;
  float core = 1.0 - smoothstep(u_core_radius - 0.08, u_core_radius, d);
  float halo = (1.0 - smoothstep(u_core_radius, 1.0, d)) * u_halo.a;
  vec3 rgb = mix(u_halo.rgb, u_core.rgb, core);
  float alpha = max(core * u_core.a, halo);
  fragColor = vec4(rgb * alpha, alpha);
}`;

type Rgba = [number, number, number, number];

const PATH_COLOR: Rgba = [0.98, 0.76, 0.2, 0.85];
const NO_HALO: Rgba = [0, 0, 0, 0];
const SUN_HALO: Rgba = [1, 0.7, 0.15, 0.45];

/** Núcleo del sol: anaranjado cerca del horizonte, blanco cálido cuando está alto. */
function sunCoreColor(altitude: number): Rgba {
  const t = Math.min(Math.max(altitude / 20, 0), 1);
  return [1, 0.62 + 0.34 * t, 0.25 + 0.55 * t, 1];
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('No se pudo crear el shader del sol');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(`Shader del sol: ${gl.getShaderInfoLog(shader) ?? 'error desconocido'}`);
  }
  return shader;
}

interface GlResources {
  program: WebGLProgram;
  buffer: WebGLBuffer;
  aPos: number;
  uMatrix: WebGLUniformLocation | null;
  uSize: WebGLUniformLocation | null;
  uCore: WebGLUniformLocation | null;
  uHalo: WebGLUniformLocation | null;
  uCoreRadius: WebGLUniformLocation | null;
  maxPointSize: number;
}

/**
 * Capa WebGL que dibuja el sol y su recorrido del día sobre una cúpula
 * centrada en la vista. Comparte el buffer de profundidad con los edificios,
 * así que un edificio alto puede tapar al sol.
 */
export class SunLayer implements CustomLayerInterface {
  readonly id = 'sun';
  readonly type = 'custom';
  readonly renderingMode = '3d';

  private map: MapLibreMap | null = null;
  private gl: GlResources | null = null;
  private sun: SunPosition | null = null;
  private path: SunPosition[] = [];

  /** Actualiza la posición del sol y el recorrido del día. */
  setSun(sun: SunPosition, path: SunPosition[]): void {
    this.sun = sun;
    this.path = path;
    this.map?.triggerRepaint();
  }

  onAdd(map: MapLibreMap, gl: WebGL2RenderingContext): void {
    this.map = map;
    const program = gl.createProgram();
    const buffer = gl.createBuffer();
    if (!program || !buffer) throw new Error('No se pudieron crear los recursos WebGL del sol');

    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`Programa del sol: ${gl.getProgramInfoLog(program) ?? 'error desconocido'}`);
    }

    const pointSizeRange = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE) as Float32Array;
    this.gl = {
      program,
      buffer,
      aPos: gl.getAttribLocation(program, 'a_pos'),
      uMatrix: gl.getUniformLocation(program, 'u_matrix'),
      uSize: gl.getUniformLocation(program, 'u_size'),
      uCore: gl.getUniformLocation(program, 'u_core'),
      uHalo: gl.getUniformLocation(program, 'u_halo'),
      uCoreRadius: gl.getUniformLocation(program, 'u_core_radius'),
      maxPointSize: pointSizeRange[1] ?? 64,
    };
  }

  onRemove(_map: MapLibreMap, gl: WebGL2RenderingContext): void {
    if (this.gl) {
      gl.deleteProgram(this.gl.program);
      gl.deleteBuffer(this.gl.buffer);
    }
    this.gl = null;
    this.map = null;
  }

  render(gl: WebGL2RenderingContext, args: CustomRenderMethodInput): void {
    const { map, sun } = this;
    const res = this.gl;
    if (!map || !res || !sun) return;

    // La cúpula sigue a la cámara: centro en lo que se mira, radio según el zoom.
    const { lng, lat } = map.getCenter();
    const center: LngLat = [lng, lat];
    const radius = DOME_RADIUS_FACTOR * map.getContainer().clientHeight * metersPerPixel(map.getZoom(), lat);

    const points = [...this.path, sun];
    const positions = new Float32Array(points.length * 3);
    points.forEach((position, i) => {
      const { lngLat, height } = sunDomePoint(center, radius, position);
      const coord = MercatorCoordinate.fromLngLat(lngLat, height);
      positions.set([coord.x, coord.y, coord.z], i * 3);
    });

    gl.useProgram(res.program);
    gl.uniformMatrix4fv(res.uMatrix, false, args.defaultProjectionData.mainMatrix as Float32List);
    gl.bindBuffer(gl.ARRAY_BUFFER, res.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(res.aPos);
    gl.vertexAttribPointer(res.aPos, 3, gl.FLOAT, false, 0, 0);

    const pixelRatio = map.getPixelRatio();
    const size = (px: number) => Math.min(px * pixelRatio, res.maxPointSize);

    // Recorrido del día: puntos chicos y sólidos.
    gl.uniform1f(res.uSize, size(PATH_DOT_SIZE_PX));
    gl.uniform4fv(res.uCore, PATH_COLOR);
    gl.uniform4fv(res.uHalo, NO_HALO);
    gl.uniform1f(res.uCoreRadius, 0.95);
    gl.drawArrays(gl.POINTS, 0, this.path.length);

    // El sol, solo si está sobre el horizonte. Su halo no escribe profundidad.
    if (sun.altitude > 0) {
      gl.depthMask(false);
      gl.uniform1f(res.uSize, size(SUN_SIZE_PX));
      gl.uniform4fv(res.uCore, sunCoreColor(sun.altitude));
      gl.uniform4fv(res.uHalo, SUN_HALO);
      gl.uniform1f(res.uCoreRadius, 0.42);
      gl.drawArrays(gl.POINTS, this.path.length, 1);
      gl.depthMask(true);
    }
  }
}
