import type { GeometryStore } from '../shadows/geometryStore';
import {
  ceilingAxes,
  ceilingExtent,
  ceilingPasses,
  type CeilingAxes,
  type CeilingGrid,
} from '../shadows/shadowCeiling';
import type { SunPosition } from '../sun/sunPosition';
import { linkProgram, uniformLocations } from './glUtils';
import { ATTR_CORNER, ATTR_EDGE, ATTR_HEIGHT, ATTR_ROOF, gpuChunk } from './gpuChunks';

// El mapa está girado: su eje v apunta al sol (ver src/shadows/shadowCeiling.ts).
const MAP_TRANSFORM = `
uniform vec2 u_center;
uniform vec2 u_axis_u;
uniform vec2 u_axis_v;
uniform float u_extent;
vec4 toCeilingClip(vec2 p) {
  vec2 d = p - u_center;
  return vec4(vec2(dot(d, u_axis_u), dot(d, u_axis_v)) / u_extent * 2.0, 0.0, 1.0);
}`;

// Altura de los edificios: los techos rellenan el interior...
const ROOF_VERTEX_SHADER = `#version 300 es
layout(location = ${ATTR_ROOF}) in vec3 a_roof;
${MAP_TRANSFORM}
out float v_height;
void main() {
  gl_Position = toCeilingClip(a_roof.xy);
  v_height = a_roof.z;
}`;

// ...y el contorno se dibuja ensanchado una celda, para que ninguna pared quede sin cubrir
// (una pared más angosta que una celda podría no tocar el centro de ninguna).
const EDGE_VERTEX_SHADER = `#version 300 es
layout(location = ${ATTR_CORNER}) in vec2 a_corner;
layout(location = ${ATTR_EDGE}) in vec4 a_edge;
layout(location = ${ATTR_HEIGHT}) in float a_height;
uniform float u_cell;
${MAP_TRANSFORM}
out float v_height;
void main() {
  vec2 a = a_edge.xy;
  vec2 b = a_edge.zw;
  vec2 e = b - a;
  vec2 dir = e / max(length(e), 1e-6);
  vec2 n = vec2(dir.y, -dir.x);
  vec2 pos = mix(a, b, a_corner.x) + dir * ((a_corner.x - 0.5) * u_cell) + n * ((a_corner.y - 0.5) * u_cell);
  gl_Position = toCeilingClip(pos);
  v_height = a_height;
}`;

const HEIGHT_FRAGMENT_SHADER = `#version 300 es
precision highp float;
in float v_height;
out vec4 fragColor;
void main() {
  fragColor = vec4(v_height, 0.0, 0.0, 1.0);
}`;

// Un triángulo que cubre toda la textura, sin buffers.
const PROPAGATE_VERTEX_SHADER = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

// M ← máx(M, M desplazado hacia el sol − caída). Mismo cálculo que `computeCeilingCpu`.
const PROPAGATE_FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D u_source;
uniform int u_size;
uniform int u_offset;
uniform float u_drop;
uniform int u_first;
out vec4 fragColor;
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  float here = (u_first == 1) ? 0.0 : texelFetch(u_source, c, 0).r;
  int target = c.y + u_offset;
  float ahead = (target < u_size) ? texelFetch(u_source, ivec2(c.x, target), 0).r - u_drop : 0.0;
  fragColor = vec4(max(max(here, ahead), 0.0), 0.0, 0.0, 1.0);
}`;

const MAP_UNIFORMS = ['u_center', 'u_axis_u', 'u_axis_v', 'u_extent'] as const;

type Locations<K extends string> = Record<K, WebGLUniformLocation | null>;

interface Resources {
  roofProgram: WebGLProgram;
  roofUniforms: Locations<(typeof MAP_UNIFORMS)[number]>;
  edgeProgram: WebGLProgram;
  edgeUniforms: Locations<(typeof MAP_UNIFORMS)[number] | 'u_cell'>;
  propagateProgram: WebGLProgram;
  propagateUniforms: Locations<'u_source' | 'u_size' | 'u_offset' | 'u_drop' | 'u_first'>;
  emptyVao: WebGLVertexArrayObject;
  textures: [WebGLTexture, WebGLTexture];
  framebuffers: [WebGLFramebuffer, WebGLFramebuffer];
}

/** Resultado de un cálculo: la textura con el techo de sombra y cómo leerla. */
export interface CeilingResult {
  texture: WebGLTexture;
  grid: CeilingGrid;
  axes: CeilingAxes;
}

function createTarget(gl: WebGL2RenderingContext, size: number): { texture: WebGLTexture; framebuffer: WebGLFramebuffer } | null {
  const texture = gl.createTexture();
  const framebuffer = gl.createFramebuffer();
  if (!texture || !framebuffer) return null;

  gl.bindTexture(gl.TEXTURE_2D, texture);
  // Media precisión (16 bits): 0,06 m de resolución a 100 m de altura, y se puede interpolar sin extensiones.
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, size, size, 0, gl.RED, gl.HALF_FLOAT, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  const complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  gl.bindTexture(gl.TEXTURE_2D, null);

  if (!complete) {
    gl.deleteTexture(texture);
    gl.deleteFramebuffer(framebuffer);
    return null;
  }
  return { texture, framebuffer };
}

/**
 * El techo de sombra en la GPU (ver `src/shadows/shadowCeiling.ts`). Dos
 * texturas de un canal que se turnan: primero se dibujan las alturas de los
 * edificios en el mapa girado hacia el sol, y después cada pasada de
 * propagación lee una y escribe la otra.
 */
export class CeilingMap {
  private constructor(
    private readonly res: Resources,
    readonly grid: CeilingGrid,
  ) {}

  /** Null si el navegador no puede dibujar en texturas de punto flotante: sin eso no hay sombras sobre edificios. */
  static tryCreate(gl: WebGL2RenderingContext, grid: CeilingGrid): CeilingMap | null {
    if (!gl.getExtension('EXT_color_buffer_float') && !gl.getExtension('EXT_color_buffer_half_float')) return null;

    const previous = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
    const first = createTarget(gl, grid.size);
    const second = first ? createTarget(gl, grid.size) : null;
    gl.bindFramebuffer(gl.FRAMEBUFFER, previous);
    if (!first || !second) {
      if (first) {
        gl.deleteTexture(first.texture);
        gl.deleteFramebuffer(first.framebuffer);
      }
      return null;
    }

    const roofProgram = linkProgram(gl, ROOF_VERTEX_SHADER, HEIGHT_FRAGMENT_SHADER, 'Techo de sombra (techos)');
    const edgeProgram = linkProgram(gl, EDGE_VERTEX_SHADER, HEIGHT_FRAGMENT_SHADER, 'Techo de sombra (paredes)');
    const propagateProgram = linkProgram(gl, PROPAGATE_VERTEX_SHADER, PROPAGATE_FRAGMENT_SHADER, 'Techo de sombra (propagación)');
    const emptyVao = gl.createVertexArray();
    if (!emptyVao) throw new Error('Techo de sombra: no se pudo crear el VAO');

    return new CeilingMap(
      {
        roofProgram,
        roofUniforms: uniformLocations(gl, roofProgram, MAP_UNIFORMS),
        edgeProgram,
        edgeUniforms: uniformLocations(gl, edgeProgram, [...MAP_UNIFORMS, 'u_cell'] as const),
        propagateProgram,
        propagateUniforms: uniformLocations(gl, propagateProgram, ['u_source', 'u_size', 'u_offset', 'u_drop', 'u_first'] as const),
        emptyVao,
        textures: [first.texture, second.texture],
        framebuffers: [first.framebuffer, second.framebuffer],
      },
      grid,
    );
  }

  dispose(gl: WebGL2RenderingContext): void {
    const { res } = this;
    gl.deleteProgram(res.roofProgram);
    gl.deleteProgram(res.edgeProgram);
    gl.deleteProgram(res.propagateProgram);
    gl.deleteVertexArray(res.emptyVao);
    for (const texture of res.textures) gl.deleteTexture(texture);
    for (const framebuffer of res.framebuffers) gl.deleteFramebuffer(framebuffer);
  }

  /**
   * Calcula el techo de sombra para el sol dado con los edificios del almacén.
   * Devuelve null si no hay nada que calcular (de noche o sin edificios).
   * Deja el estado de WebGL listo para que MapLibre lo restaure.
   */
  compute(gl: WebGL2RenderingContext, store: GeometryStore, sun: SunPosition): CeilingResult | null {
    const { res, grid } = this;
    const passes = ceilingPasses(sun, grid, store.maxHeight);
    if (passes.length === 0 || store.chunks.length === 0) return null;

    const axes = ceilingAxes(sun);
    const previousFramebuffer = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
    const previousViewport = gl.getParameter(gl.VIEWPORT) as Int32Array;

    gl.viewport(0, 0, grid.size, grid.size);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.STENCIL_TEST);
    gl.disable(gl.CULL_FACE);
    gl.colorMask(true, true, true, true);

    // 1) Alturas de los edificios, con "máximo" como mezcla: donde se superponen, gana el más alto.
    gl.bindFramebuffer(gl.FRAMEBUFFER, res.framebuffers[1]);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.MAX);
    gl.blendFunc(gl.ONE, gl.ONE);

    const extent = ceilingExtent(grid);
    const setMap = (uniforms: Locations<(typeof MAP_UNIFORMS)[number]>) => {
      gl.uniform2f(uniforms.u_center, grid.centerX, grid.centerY);
      gl.uniform2f(uniforms.u_axis_u, axes.u[0], axes.u[1]);
      gl.uniform2f(uniforms.u_axis_v, axes.v[0], axes.v[1]);
      gl.uniform1f(uniforms.u_extent, extent);
    };

    gl.useProgram(res.roofProgram);
    setMap(res.roofUniforms);
    for (const chunk of store.chunks) {
      const gpu = gpuChunk(gl, chunk);
      gl.bindVertexArray(gpu.roofVao);
      gl.drawElements(gl.TRIANGLES, gpu.indexCount, gl.UNSIGNED_INT, 0);
    }

    gl.useProgram(res.edgeProgram);
    setMap(res.edgeUniforms);
    gl.uniform1f(res.edgeUniforms.u_cell, grid.cell);
    for (const chunk of store.chunks) {
      const gpu = gpuChunk(gl, chunk);
      gl.bindVertexArray(gpu.wallVao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, gpu.edgeCount);
    }

    gl.disable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);

    // 2) Propagación: cada pasada lee una textura y escribe la otra. Arranca leyendo la [1], donde están las alturas.
    gl.useProgram(res.propagateProgram);
    gl.bindVertexArray(res.emptyVao);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(res.propagateUniforms.u_source, 0);
    gl.uniform1i(res.propagateUniforms.u_size, grid.size);

    let read = 1;
    for (const pass of passes) {
      const write = 1 - read;
      gl.bindFramebuffer(gl.FRAMEBUFFER, res.framebuffers[write] as WebGLFramebuffer);
      gl.bindTexture(gl.TEXTURE_2D, res.textures[read] as WebGLTexture);
      gl.uniform1i(res.propagateUniforms.u_offset, pass.offset);
      gl.uniform1f(res.propagateUniforms.u_drop, pass.drop);
      gl.uniform1i(res.propagateUniforms.u_first, pass.first ? 1 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      read = write;
    }

    gl.bindVertexArray(null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, previousFramebuffer);
    gl.viewport(previousViewport[0] ?? 0, previousViewport[1] ?? 0, previousViewport[2] ?? 0, previousViewport[3] ?? 0);

    return { texture: res.textures[read] as WebGLTexture, grid, axes };
  }
}
