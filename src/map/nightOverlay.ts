import type { Map as MapLibreMap } from 'maplibre-gl';

/** Fin del crepúsculo civil: con el sol 6° bajo el horizonte ya es de noche. */
export const CIVIL_TWILIGHT_DEG = -6;

/** Opacidad máxima del velo nocturno sobre el mapa. */
const MAX_NIGHT_OPACITY = 0.6;

/** 0 de día, 1 de noche cerrada, gradual durante el crepúsculo. */
export function nightFactor(altitude: number): number {
  if (altitude >= 0) return 0;
  if (altitude <= CIVIL_TWILIGHT_DEG) return 1;
  return altitude / CIVIL_TWILIGHT_DEG;
}

/**
 * Velo azul oscuro sobre el mapa que se hace visible al anochecer. Va dentro
 * del contenedor del canvas: oscurece el mapa pero no los controles, y no
 * intercepta el mouse.
 */
export function createNightOverlay(map: MapLibreMap): { update(altitude: number): void } {
  const overlay = document.createElement('div');
  overlay.className = 'night-overlay';
  overlay.setAttribute('aria-hidden', 'true');
  map.getCanvasContainer().append(overlay);

  return {
    update(altitude: number) {
      overlay.style.opacity = String(nightFactor(altitude) * MAX_NIGHT_OPACITY);
    },
  };
}
