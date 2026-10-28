import { Map as MapLibreMap, NavigationControl, ScaleControl, setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { BASEMAP_STYLE_URL, type AreaConfig } from '../config';

// MapLibre v6 con bundler: hay que indicarle de dónde cargar su web worker.
// `?worker&url` hace que Vite empaquete el worker con sus dependencias.
setWorkerUrl(workerUrl);

/**
 * Crea el mapa base 3D centrado en la zona. Lanza `GPUInitializationError`
 * si el navegador no soporta WebGL2.
 */
export function createMap(container: HTMLElement, area: AreaConfig): MapLibreMap {
  const map = new MapLibreMap({
    container,
    style: BASEMAP_STYLE_URL,
    center: area.center,
    zoom: area.initialView.zoom,
    pitch: area.initialView.pitch,
    bearing: area.initialView.bearing,
    // Permite inclinar la cámara casi hasta el horizonte (el default es 60°).
    maxPitch: 85,
    // Suaviza los bordes de los edificios, que dibuja una capa propia (por defecto MapLibre no lo activa).
    canvasContextAttributes: { antialias: true },
  });

  map.addControl(new NavigationControl({ visualizePitch: true }), 'top-right');
  map.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-left');

  return map;
}
