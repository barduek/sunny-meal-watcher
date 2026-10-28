/** Utilidades chicas de WebGL compartidas por las capas propias del mapa. */

function compile(gl: WebGL2RenderingContext, type: number, source: string, label: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error(`${label}: no se pudo crear el shader`);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(`${label}: ${gl.getShaderInfoLog(shader) ?? 'error desconocido al compilar el shader'}`);
  }
  return shader;
}

/** Compila y enlaza un programa. `label` identifica de qué capa es en los mensajes de error. */
export function linkProgram(gl: WebGL2RenderingContext, vertex: string, fragment: string, label: string): WebGLProgram {
  const program = gl.createProgram();
  if (!program) throw new Error(`${label}: no se pudo crear el programa`);
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, vertex, label));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fragment, label));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`${label}: ${gl.getProgramInfoLog(program) ?? 'error desconocido al enlazar el programa'}`);
  }
  return program;
}

/** Ubicaciones de los uniforms de un programa, por nombre. */
export function uniformLocations<K extends string>(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  names: readonly K[],
): Record<K, WebGLUniformLocation | null> {
  const locations = {} as Record<K, WebGLUniformLocation | null>;
  for (const name of names) locations[name] = gl.getUniformLocation(program, name);
  return locations;
}

/** Matriz en doble precisión → float32 para subirla a la GPU. */
export const toFloat32 = (matrix: ArrayLike<number>): Float32Array => Float32Array.from(matrix);

/** Crea un buffer con los datos dados. Queda enlazado a `target`. */
export function createBuffer(
  gl: WebGL2RenderingContext,
  data: ArrayBufferView,
  label: string,
  target: number = gl.ARRAY_BUFFER,
): WebGLBuffer {
  const buffer = gl.createBuffer();
  if (!buffer) throw new Error(`${label}: no se pudo crear un buffer`);
  gl.bindBuffer(target, buffer);
  gl.bufferData(target, data, gl.STATIC_DRAW);
  return buffer;
}
