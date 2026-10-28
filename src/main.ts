import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';
import { GPUInitializationError, type Map as MapLibreMap } from 'maplibre-gl';
import { startBuildingStream, type StreamState } from './app/buildingStream';
import { createSunScene } from './app/sunScene';
import { loadManifest } from './buildings/load';
import { PALERMO } from './config';
import { dataUrl, joinUrl } from './dataUrl';
import { addDataAttribution, hideBasemapBuildings } from './map/buildingsLayer';
import { createMap } from './map/createMap';
import { toZonedDateTime, type ZonedDateTime } from './sun/time';
import { describeBuildingData, describeLoadProgress, describeSnapshot } from './ui/format';
import { bindTimeControls, findTimeControls, renderSnapshot, setStatus, snapToSlider } from './ui/timeControls';

function showFatal(message: string): void {
  const box = document.createElement('div');
  box.className = 'fatal';
  box.setAttribute('role', 'alert');
  box.textContent = message;
  document.body.append(box);
}

async function start(container: HTMLElement): Promise<void> {
  const area = PALERMO;
  const panel = findTimeControls();
  panel.area.textContent = area.name;

  let map: MapLibreMap;
  try {
    map = createMap(container, area);
  } catch (error) {
    if (error instanceof GPUInitializationError) {
      showFatal('Tu navegador no soporta WebGL2, que hace falta para mostrar el mapa 3D.');
      return;
    }
    throw error;
  }

  // Si el mapa base no termina de cargar (sin conexión, servidor caído), se avisa en el panel.
  const reportMapError = () => {
    setStatus(panel, 'No se pudo cargar el mapa base. Revisá la conexión y recargá la página.', 'error');
  };
  map.on('error', reportMapError);

  // El índice de edificios (chico) se baja mientras carga el mapa base. Si falla, la app sigue sin sombras.
  const datasetUrl = dataUrl(area.dataPath);
  const manifestRequest = loadManifest(joinUrl(datasetUrl, 'index.json')).catch((error: unknown) => {
    console.error('No se pudo cargar el índice de edificios', error);
    return null;
  });
  const [manifest] = await Promise.all([manifestRequest, map.once('load')]);
  map.off('error', reportMapError);

  // Si no hay edificios, quedan visibles los planos del mapa base.
  if (manifest) {
    hideBasemapBuildings(map);
    addDataAttribution(map, manifest.source.attribution);
  }
  const scene = createSunScene(map, area);

  const apply = (local: ZonedDateTime) => {
    const { sun, times } = scene.update(local);
    renderSnapshot(panel, describeSnapshot(local, sun, times, area.timeZone));
  };

  // El slider dispara muchos eventos por segundo: se aplica como mucho uno por cuadro.
  let pending: ZonedDateTime | null = null;
  let frame = 0;
  const schedule = (local: ZonedDateTime) => {
    pending = local;
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (pending) apply(pending);
      pending = null;
    });
  };

  // El sol y los controles andan sin esperar a los edificios. Arranca en la fecha y hora actuales de la zona.
  const initial = snapToSlider(toZonedDateTime(new Date(), area.timeZone));
  bindTimeControls(panel, initial, schedule);
  apply(initial);

  if (!manifest) {
    setStatus(panel, 'No se pudieron cargar los edificios: el sol se mueve igual, pero sin sombras.', 'error');
    return;
  }

  const showState = ({ stats, progress }: StreamState) => {
    panel.dataNote.textContent = describeBuildingData(stats, manifest.source.name);
    if (progress.pending > 0) {
      setStatus(panel, describeLoadProgress(progress.pending));
    } else if (progress.failed > 0) {
      setStatus(panel, 'No se pudieron cargar algunas zonas de edificios. Se reintenta al mover el mapa.', 'error');
    } else {
      setStatus(panel, null);
    }
  };

  startBuildingStream(map, manifest, datasetUrl, {
    onBuildings: (buildings) => scene.addBuildings(buildings),
    onState: showState,
  });
}

const container = document.getElementById('map');
if (!container) throw new Error('Falta el contenedor #map en index.html');

start(container).catch((error: unknown) => {
  console.error('Error al iniciar el mapa', error);
});
