import type { Map as MapLibreMap } from 'maplibre-gl';
import { ChunkLoader, type ChunkProgress } from '../buildings/chunkLoader';
import { chunksInBounds, viewportBounds, type ChunkManifest } from '../buildings/chunks';
import { loadBuildings } from '../buildings/load';
import type { Building } from '../buildings/types';
import { joinUrl } from '../dataUrl';
import { metersPerPixel } from '../geo/local';
import type { BuildingStats } from '../ui/format';

/** Por debajo de este zoom no se piden zonas nuevas: los edificios serían puntitos. */
export const MIN_BUILDINGS_ZOOM = 14;

/** Cuánto se agranda la vista al decidir qué zonas pedir (cubre lo que se ve hacia el horizonte con el mapa inclinado). */
const VIEW_MARGIN = 1.3;

export interface StreamState {
  stats: BuildingStats;
  progress: ChunkProgress;
}

/**
 * Pide los edificios por zonas, empezando por las más cercanas al centro de la
 * vista, y vuelve a pedir cada vez que el usuario termina de mover el mapa.
 * Cada zona que llega se entrega por `onBuildings`.
 */
export function startBuildingStream(
  map: MapLibreMap,
  manifest: ChunkManifest,
  datasetUrl: string,
  handlers: { onBuildings: (buildings: Building[]) => void; onState: (state: StreamState) => void },
): { dispose: () => void } {
  const stats: BuildingStats = { loaded: 0, total: manifest.total, assumed: 0 };
  let progress: ChunkProgress = { loaded: 0, pending: 0, failed: 0 };
  const emit = () => handlers.onState({ stats: { ...stats }, progress });

  const loader = new ChunkLoader({
    // El número de versión evita que una caché vieja sirva datos de otra generación.
    fetchChunk: (entry, signal) =>
      loadBuildings(`${joinUrl(datasetUrl, entry.file)}?v=${encodeURIComponent(manifest.dataVersion)}`, signal),
    onChunk: (_entry, buildings) => {
      stats.loaded += buildings.length;
      stats.assumed += buildings.filter((building) => building.heightSource === 'default').length;
      handlers.onBuildings(buildings);
      emit();
    },
    onProgress: (next) => {
      progress = next;
      emit();
    },
    onError: (entry, error) => console.error(`No se pudo cargar la zona ${entry.id} de edificios`, error),
  });

  const requestVisible = () => {
    const zoom = map.getZoom();
    if (zoom < MIN_BUILDINGS_ZOOM) return;
    const { lng, lat } = map.getCenter();
    const { clientWidth, clientHeight } = map.getContainer();
    const bounds = viewportBounds([lng, lat], metersPerPixel(zoom, lat), clientWidth, clientHeight, VIEW_MARGIN);
    loader.request(chunksInBounds(manifest, bounds, [lng, lat]));
  };

  map.on('moveend', requestVisible);
  requestVisible();

  return {
    dispose() {
      map.off('moveend', requestVisible);
      loader.dispose();
    },
  };
}
