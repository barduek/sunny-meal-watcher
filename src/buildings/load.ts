import type { FeatureCollection, Geometry } from 'geojson';
import { isChunkManifest, type ChunkManifest } from './chunks';
import { normalizeFeatureCollection } from './normalize';
import type { Building } from './types';

function isFeatureCollection(value: unknown): value is FeatureCollection<Geometry | null> {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { type?: unknown; features?: unknown };
  return candidate.type === 'FeatureCollection' && Array.isArray(candidate.features);
}

/**
 * Descarga un GeoJSON de edificios (una zona del dataset) y lo normaliza. El
 * archivo puede venir de cualquier fuente: todas usan el mismo formato.
 */
export async function loadBuildings(url: string, signal?: AbortSignal): Promise<Building[]> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`No se pudieron cargar los edificios (${response.status} ${response.statusText}): ${url}`);
  }

  const data: unknown = await response.json();
  if (!isFeatureCollection(data)) {
    throw new Error(`El archivo de edificios no es una FeatureCollection GeoJSON: ${url}`);
  }
  return normalizeFeatureCollection(data);
}

/** Descarga el índice del dataset (`index.json`): qué zonas hay y dónde están. */
export async function loadManifest(url: string, signal?: AbortSignal): Promise<ChunkManifest> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`No se encontró el índice de edificios (${response.status} ${response.statusText}): ${url}`);
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    // El servidor de desarrollo responde con el index.html de la app cuando falta un archivo.
    throw new Error(`El índice de edificios no es un JSON válido: ${url}. ¿Falta generar los datos con "npm run fetch:buildings"?`);
  }
  if (!isChunkManifest(data)) {
    throw new Error(`El índice de edificios no tiene el formato esperado: ${url}`);
  }
  return data;
}
