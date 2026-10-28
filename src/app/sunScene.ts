import type { Map as MapLibreMap } from 'maplibre-gl';
import type { Building } from '../buildings/types';
import type { AreaConfig } from '../config';
import { BuildingsLayer, firstSymbolLayerId } from '../map/buildingsLayer';
import { createNightOverlay } from '../map/nightOverlay';
import { ShadowLayer } from '../map/shadowsLayer';
import { SunLayer } from '../map/sunLayer';
import { GeometryStore, areaLocalBounds } from '../shadows/geometryStore';
import { getSunPath, getSunPosition, getSunTimes, type SunPosition, type SunTimes } from '../sun/sunPosition';
import { fromZonedDateTime, localDayRange, type ZonedDateTime } from '../sun/time';

export interface SunSnapshot {
  local: ZonedDateTime;
  instant: Date;
  sun: SunPosition;
  times: SunTimes;
}

interface DayData {
  date: string;
  path: SunPosition[];
  times: SunTimes;
}

/** Margen alrededor del área para los edificios que la cruzan (m). */
const AREA_MARGIN_M = 60;

/**
 * Todo lo que depende de la fecha y la hora: el sol en la escena, los
 * edificios con sus sombras, y el velo nocturno. El recorrido y los horarios
 * del día se recalculan solo cuando cambia la fecha. Los edificios llegan por
 * zonas con `addBuildings`.
 */
export function createSunScene(map: MapLibreMap, area: AreaConfig) {
  const store = new GeometryStore(area.center);
  const shadowLayer = new ShadowLayer(store);
  const buildingsLayer = new BuildingsLayer(store, areaLocalBounds(store.frame, area.bbox, AREA_MARGIN_M));

  // Las sombras del suelo se dibujan antes que los edificios: los edificios tapan la sombra que queda detrás.
  // Los dos van debajo de las etiquetas del mapa.
  const beforeLabels = firstSymbolLayerId(map);
  map.addLayer(shadowLayer, beforeLabels);
  map.addLayer(buildingsLayer, beforeLabels);
  const sunLayer = new SunLayer();
  map.addLayer(sunLayer);
  const night = createNightOverlay(map);

  let day: DayData | null = null;

  function dayData(date: string): DayData {
    if (day?.date !== date) {
      const { start, end } = localDayRange(date, area.timeZone);
      // Horarios a partir del mediodía local: así siempre corresponden al día elegido.
      const noon = fromZonedDateTime({ date, minutes: 12 * 60 }, area.timeZone);
      day = { date, path: getSunPath(start, end, area.center), times: getSunTimes(noon, area.center) };
    }
    return day;
  }

  return {
    /** Suma los edificios de una zona que acaba de llegar. */
    addBuildings(buildings: Building[]): void {
      if (store.add(buildings)) map.triggerRepaint();
    },

    update(local: ZonedDateTime): SunSnapshot {
      const { path, times } = dayData(local.date);
      const instant = fromZonedDateTime(local, area.timeZone);
      const sun = getSunPosition(instant, area.center);

      shadowLayer.setSun(sun);
      buildingsLayer.setSun(sun);
      sunLayer.setSun(sun, path);
      night.update(sun.altitude);

      return { local, instant, sun, times };
    },
  };
}
