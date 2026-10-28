import type { ChunkGeometry } from '../shadows/geometryStore';
import { FLOATS_PER_EDGE } from '../shadows/gpuGeometry';
import { FLOATS_PER_ROOF_VERTEX } from '../shadows/roofMesh';
import { createBuffer } from './glUtils';

/**
 * Ubicaciones fijas de los atributos: así los mismos VAO sirven para todos los
 * programas (edificios, sombras en el suelo, techo de sombra). Cada shader
 * declara con `layout(location = N)` los que usa.
 */
export const ATTR_CORNER = 0; // vec2: esquina del cuadrilátero de una pared (0 o 1 en cada eje)
export const ATTR_EDGE = 1; //   vec4: ax, ay, bx, by (por arista, instanciado)
export const ATTR_HEIGHT = 2; // float: altura del edificio (por arista, instanciado)
export const ATTR_ROOF = 3; //   vec3: x, y, altura de un vértice de techo

/** Los buffers de una zona en la GPU, con los VAO listos para dibujarla. */
export interface GpuChunk {
  /** Una pared (4 vértices en tira) por arista, instanciada: `drawArraysInstanced(TRIANGLE_STRIP, 0, 4, edgeCount)`. */
  wallVao: WebGLVertexArrayObject;
  edgeCount: number;
  /** Los techos triangulados: `drawElements(TRIANGLES, indexCount, UNSIGNED_INT, 0)`. */
  roofVao: WebGLVertexArrayObject;
  indexCount: number;
}

interface PerContext {
  corner: WebGLBuffer;
  chunks: WeakMap<ChunkGeometry, GpuChunk>;
}

const contexts = new WeakMap<WebGL2RenderingContext, PerContext>();

function contextState(gl: WebGL2RenderingContext): PerContext {
  let state = contexts.get(gl);
  if (!state) {
    state = {
      corner: createBuffer(gl, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), 'esquinas de pared'),
      chunks: new WeakMap(),
    };
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    contexts.set(gl, state);
  }
  return state;
}

/**
 * Los recursos de GPU de una zona. La primera vez sube los datos; después
 * devuelve los mismos, así las distintas capas comparten los buffers.
 */
export function gpuChunk(gl: WebGL2RenderingContext, chunk: ChunkGeometry): GpuChunk {
  const state = contextState(gl);
  const cached = state.chunks.get(chunk);
  if (cached) return cached;

  const wallVao = gl.createVertexArray();
  const roofVao = gl.createVertexArray();
  if (!wallVao || !roofVao) throw new Error('No se pudieron crear los VAO de una zona de edificios');

  // Paredes: esquinas compartidas + una instancia por arista.
  gl.bindVertexArray(wallVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, state.corner);
  gl.enableVertexAttribArray(ATTR_CORNER);
  gl.vertexAttribPointer(ATTR_CORNER, 2, gl.FLOAT, false, 0, 0);

  createBuffer(gl, chunk.edges, 'aristas de edificios');
  const stride = FLOATS_PER_EDGE * 4;
  gl.enableVertexAttribArray(ATTR_EDGE);
  gl.vertexAttribPointer(ATTR_EDGE, 4, gl.FLOAT, false, stride, 0);
  gl.vertexAttribDivisor(ATTR_EDGE, 1);
  gl.enableVertexAttribArray(ATTR_HEIGHT);
  gl.vertexAttribPointer(ATTR_HEIGHT, 1, gl.FLOAT, false, stride, 16);
  gl.vertexAttribDivisor(ATTR_HEIGHT, 1);

  // Techos: vértices + índices. El buffer de índices se sube con el VAO enlazado, que es lo que lo asocia a él
  // (y no al VAO por defecto, que usa MapLibre).
  gl.bindVertexArray(roofVao);
  createBuffer(gl, chunk.roofVertices, 'techos de edificios');
  gl.enableVertexAttribArray(ATTR_ROOF);
  gl.vertexAttribPointer(ATTR_ROOF, 3, gl.FLOAT, false, FLOATS_PER_ROOF_VERTEX * 4, 0);
  createBuffer(gl, chunk.roofIndices, 'índices de techos', gl.ELEMENT_ARRAY_BUFFER);

  gl.bindVertexArray(null);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);

  const gpu: GpuChunk = { wallVao, edgeCount: chunk.edgeCount, roofVao, indexCount: chunk.roofIndices.length };
  state.chunks.set(chunk, gpu);
  return gpu;
}
