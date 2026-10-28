/**
 * Dónde viven los datos de edificios. Por defecto salen del mismo sitio que la
 * app (carpeta `data/`), y con `VITE_DATA_BASE_URL` pueden estar en otro
 * servidor o CDN. Ese servidor tiene que permitir CORS para el sitio de la app.
 */

/** Une una URL base con una ruta. Si la ruta ya es absoluta (https://…), la devuelve tal cual. */
export function joinUrl(base: string, path: string): string {
  if (/^([a-z][a-z\d+.-]*:)?\/\//i.test(path)) return path;
  if (base === '') return path;
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

/** URL base de los datos: la variable de entorno si está, y si no la de la app. */
export const DATA_BASE_URL: string = import.meta.env.VITE_DATA_BASE_URL || import.meta.env.BASE_URL;

export function dataUrl(path: string): string {
  return joinUrl(DATA_BASE_URL, path);
}
