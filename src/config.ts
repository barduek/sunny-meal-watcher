/**
 * Configuración de la zona que cubre la app. Todo lo específico de
 * "Palermo" vive acá, así sumar otra zona o ciudad es agregar otro objeto.
 */
export interface AreaConfig {
  id: string;
  name: string;
  /** Centro de referencia [lng, lat]: se usa para la cámara y el cálculo solar. */
  center: [number, number];
  /** Área cubierta [oeste, sur, este, norte] en grados. */
  bbox: [number, number, number, number];
  /** Zona horaria IANA en la que se interpretan la fecha y la hora elegidas. */
  timeZone: string;
  initialView: { zoom: number; pitch: number; bearing: number };
  /**
   * Carpeta con los edificios (`index.json` + zonas), relativa a la URL base de
   * los datos (ver `src/dataUrl.ts`). La generan los scripts `fetch:buildings*`.
   * De dónde salen los datos y su atribución vienen dentro del propio índice.
   */
  dataPath: string;
}

/** Palermo Soho + Hollywood (~2,4 × 2,1 km), el núcleo gastronómico del barrio. */
export const PALERMO: AreaConfig = {
  id: 'palermo',
  name: 'Palermo, Buenos Aires',
  center: [-58.4303, -34.5889], // Plaza Serrano
  bbox: [-58.445, -34.598, -58.419, -34.579],
  timeZone: 'America/Argentina/Buenos_Aires',
  initialView: { zoom: 16, pitch: 60, bearing: -20 },
  // Generado con `npm run fetch:buildings` (usa este mismo bbox).
  dataPath: 'data/palermo',
};

/** Mapa base de OpenFreeMap: gratuito, sin API key, con datos de OpenStreetMap. */
export const BASEMAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/positron';
