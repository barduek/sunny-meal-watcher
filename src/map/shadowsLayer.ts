import type { CustomLayerInterface, CustomRenderMethodInput, Map as MapLibreMap } from 'maplibre-gl';
import { multiplyMat4 } from '../shadows/gpuGeometry';
import type { GeometryStore } from '../shadows/geometryStore';
import { MAX_SHADOW_LENGTH_M, shadowVector } from '../shadows/projectShadow';
import type { SunPosition } from '../sun/sunPosition';
import { linkProgram, toFloat32, uniformLocations } from './glUtils';
import { ATTR_CORNER, ATTR_EDGE, ATTR_HEIGHT, gpuChunk } from './gpuChunks';

export const SHADOWS_LAYER_ID = 'shadows';

/** Mismo tono que la leyenda: #27304a al 40%, en alfa premultiplicado. */
const SHADOW_COLOR = [(39 / 255) * 0.4, (48 / 255) * 0.4, (74 / 255) * 0.4, 0.4];

// Cada arista (a → b) se dibuja como un cuadrilátero: la arista y su copia
// desplazada en la dirección de la sombra. Solo proyectan las aristas del lado
// contrario al sol (normal exterior a favor de la sombra); en las demás el
// cuadrilátero queda sin área. La unión de esos cuadriláteros es la sombra
// exacta del prisma fuera de su huella (lo de adentro lo tapa el edificio).
const EDGES_VERTEX_SHADER = `#version 300 es
layout(location = ${ATTR_CORNER}) in vec2 a_corner;
layout(location = ${ATTR_EDGE}) in vec4 a_edge;
layout(location = ${ATTR_HEIGHT}) in float a_height;
uniform mat4 u_matrix;
uniform vec2 u_shadow;
uniform float u_max_length;
void main() {
  vec2 a = a_edge.xy;
  vec2 b = a_edge.zw;
  vec2 edge = b - a;
  vec2 offset = u_shadow * a_height;
  float len = length(offset);
  if (len > u_max_length) offset *= u_max_length / len;
  float casts = dot(vec2(edge.y, -edge.x), offset) > 0.0 ? 1.0 : 0.0;
  vec2 position = mix(a, b, a_corner.x) + offset * (a_corner.y * casts);
  gl_Position = u_matrix * vec4(position, 0.0, 1.0);
}`;

const EDGES_FRAGMENT_SHADER = `#version 300 es
precision mediump float;
out vec4 fragColor;
void main() {
  fragColor = vec4(1.0);
}`;

// Segunda pasada: la textura de cobertura se pinta sobre el mapa con opacidad pareja.
// Un triángulo que cubre toda la pantalla, sin buffers.
const COMPOSITE_VERTEX_SHADER = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const COMPOSITE_FRAGMENT_SHADER = `#version 300 es
precision mediump float;
uniform sampler2D u_coverage;
uniform vec4 u_color;
out vec4 fragColor;
void main() {
  float coverage = texelFetch(u_coverage, ivec2(gl_FragCoord.xy), 0).r;
  fragColor = u_color * coverage;
}`;

const EDGE_UNIFORMS = ['u_matrix', 'u_shadow', 'u_max_length'] as const;
const COMPOSITE_UNIFORMS = ['u_coverage', 'u_color'] as const;

interface GlResources {
  edgesProgram: WebGLProgram;
  edgesUniforms: Record<(typeof EDGE_UNIFORMS)[number], WebGLUniformLocation | null>;
  compositeProgram: WebGLProgram;
  compositeUniforms: Record<(typeof COMPOSITE_UNIFORMS)[number], WebGLUniformLocation | null>;
  emptyVao: WebGLVertexArrayObject;
  texture: WebGLTexture;
  framebuffer: WebGLFramebuffer;
  size: [number, number];
}

/**
 * Sombras de los edificios sobre el suelo, dibujadas en la GPU: las aristas se
 * cargan una sola vez y cambiar la hora solo actualiza la dirección de la
 * sombra, sin importar cuántos edificios haya. La geometría sale del
 * `GeometryStore` compartido con las demás capas.
 *
 * Primero se pintan en una textura propia (`prerender`), donde las
 * superposiciones no suman. Después esa textura se pinta sobre el mapa con
 * opacidad pareja (`render`). La capa va antes que la de edificios: los
 * edificios, opacos, tapan la sombra que queda detrás de ellos.
 */
export class ShadowLayer implements CustomLayerInterface {
  readonly id = SHADOWS_LAYER_ID;
  readonly type = 'custom';
  readonly renderingMode = '3d';

  private map: MapLibreMap | null = null;
  private gl: GlResources | null = null;
  private sun: SunPosition | null = null;
  private coverageReady = false;

  constructor(private readonly store: GeometryStore) {}

  setSun(sun: SunPosition): void {
    this.sun = sun;
    this.map?.triggerRepaint();
  }

  onAdd(map: MapLibreMap, gl: WebGL2RenderingContext): void {
    this.map = map;
    const edgesProgram = linkProgram(gl, EDGES_VERTEX_SHADER, EDGES_FRAGMENT_SHADER, 'Sombras en el suelo');
    const compositeProgram = linkProgram(gl, COMPOSITE_VERTEX_SHADER, COMPOSITE_FRAGMENT_SHADER, 'Sombras en el suelo (composición)');
    const emptyVao = gl.createVertexArray();
    const texture = gl.createTexture();
    const framebuffer = gl.createFramebuffer();
    if (!emptyVao || !texture || !framebuffer) throw new Error('No se pudieron crear los recursos WebGL de las sombras');

    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);

    this.gl = {
      edgesProgram,
      edgesUniforms: uniformLocations(gl, edgesProgram, EDGE_UNIFORMS),
      compositeProgram,
      compositeUniforms: uniformLocations(gl, compositeProgram, COMPOSITE_UNIFORMS),
      emptyVao,
      texture,
      framebuffer,
      size: [0, 0],
    };
  }

  onRemove(_map: MapLibreMap, gl: WebGL2RenderingContext): void {
    const res = this.gl;
    if (res) {
      gl.deleteProgram(res.edgesProgram);
      gl.deleteProgram(res.compositeProgram);
      gl.deleteVertexArray(res.emptyVao);
      gl.deleteTexture(res.texture);
      gl.deleteFramebuffer(res.framebuffer);
    }
    this.gl = null;
    this.map = null;
  }

  /** La textura de cobertura acompaña el tamaño del canvas. */
  private resizeTarget(gl: WebGL2RenderingContext, res: GlResources): void {
    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;
    if (res.size[0] === width && res.size[1] === height) return;

    gl.bindTexture(gl.TEXTURE_2D, res.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, width, height, 0, gl.RED, gl.UNSIGNED_BYTE, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, res.framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, res.texture, 0);
    res.size = [width, height];
  }

  prerender(gl: WebGL2RenderingContext, args: CustomRenderMethodInput): void {
    this.coverageReady = false;
    const res = this.gl;
    // Desplazamiento de la sombra por metro de altura; null de noche.
    const perMeter = this.sun ? shadowVector(1, this.sun, Number.POSITIVE_INFINITY) : null;
    if (!res || !perMeter || this.store.chunks.length === 0) return;

    const previousFramebuffer = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
    const previousViewport = gl.getParameter(gl.VIEWPORT) as Int32Array;

    this.resizeTarget(gl, res);
    gl.bindFramebuffer(gl.FRAMEBUFFER, res.framebuffer);
    gl.viewport(0, 0, res.size[0], res.size[1]);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.STENCIL_TEST);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    gl.colorMask(true, true, true, true);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    // Metros locales → Mercator → pantalla, compuesto en doble precisión.
    const matrix = toFloat32(multiplyMat4(args.defaultProjectionData.mainMatrix, this.store.model));
    gl.useProgram(res.edgesProgram);
    gl.uniformMatrix4fv(res.edgesUniforms.u_matrix, false, matrix);
    gl.uniform2f(res.edgesUniforms.u_shadow, perMeter.east, perMeter.north);
    gl.uniform1f(res.edgesUniforms.u_max_length, MAX_SHADOW_LENGTH_M);
    for (const chunk of this.store.chunks) {
      const gpu = gpuChunk(gl, chunk);
      gl.bindVertexArray(gpu.wallVao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, gpu.edgeCount);
    }
    gl.bindVertexArray(null);

    gl.bindFramebuffer(gl.FRAMEBUFFER, previousFramebuffer);
    gl.viewport(previousViewport[0] ?? 0, previousViewport[1] ?? 0, previousViewport[2] ?? 0, previousViewport[3] ?? 0);
    this.coverageReady = true;
  }

  render(gl: WebGL2RenderingContext): void {
    const res = this.gl;
    if (!res || !this.coverageReady) return;

    // La sombra está en el suelo: no escribe profundidad y no se prueba contra ella.
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    gl.useProgram(res.compositeProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, res.texture);
    gl.uniform1i(res.compositeUniforms.u_coverage, 0);
    gl.uniform4fv(res.compositeUniforms.u_color, SHADOW_COLOR);
    gl.bindVertexArray(res.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.depthMask(true);
  }
}
