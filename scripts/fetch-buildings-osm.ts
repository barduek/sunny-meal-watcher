/**
 * Fuente alternativa: descarga los edificios de OpenStreetMap para la zona y
 * los guarda como dataset por zonas, en una carpeta aparte para no pisar el del GCBA. Uso:
 *
 *   npm run fetch:buildings:osm                 # escribe public/<dataPath>-osm
 *   npm run fetch:buildings:osm -- otra/carpeta
 *
 * Para que la app lo use, apuntar `dataPath` (src/config.ts) a esa carpeta.
 */
import { resolve } from 'node:path';
import { resolveHeight } from '../src/buildings/normalize';
import { OSM_SOURCE, buildOverpassQuery, overpassToGeoJSON, type OverpassResponse } from '../src/buildings/overpass';
import { PALERMO } from '../src/config';
import { writeChunkedDataset } from './lib/chunkedDataset';

/** Instancias públicas de Overpass: si una está saturada se prueba la siguiente. */
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

const USER_AGENT = 'sunny-meal-watcher/0.1 (snapshot de edificios)';

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function queryOverpass(query: string): Promise<{ data: OverpassResponse; endpoint: string }> {
  const failures: string[] = [];

  for (const endpoint of ENDPOINTS) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': USER_AGENT },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(120_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      // Saturado, Overpass puede responder 200 con una página HTML de error.
      const data = JSON.parse(await response.text()) as OverpassResponse;
      if (!Array.isArray(data.elements)) throw new Error('la respuesta no trae "elements"');
      if (data.remark?.toLowerCase().includes('error')) throw new Error(data.remark);

      return { data, endpoint };
    } catch (error) {
      failures.push(`  ${endpoint}: ${describeError(error)}`);
    }
  }

  throw new Error(`Ningún servidor de Overpass respondió bien:\n${failures.join('\n')}`);
}

const area = PALERMO;
const output = resolve(process.argv[2] ?? `public/${area.dataPath}-osm`);

console.log(`Descargando edificios de ${area.name} (bbox ${area.bbox.join(', ')})…`);
const { data, endpoint } = await queryOverpass(buildOverpassQuery(area.bbox));
const { features } = overpassToGeoJSON(data);

const bySource = { height: 0, levels: 0, default: 0 };
for (const feature of features) bySource[resolveHeight(feature.properties).heightSource] += 1;

const osmTimestamp = data.osm3s?.timestamp_osm_base ?? null;
const { manifest, bytes } = await writeChunkedDataset({ outputDir: output, area, source: OSM_SOURCE, features });

console.log(`Servidor: ${endpoint} (datos OSM al ${osmTimestamp ?? 'desconocido'})`);
console.log(`Edificios: ${features.length} (de ${data.elements.length} elementos)`);
console.log(`Zonas: ${manifest.chunks.length} (${(bytes / 1e6).toFixed(1)} MB en total, versión ${manifest.dataVersion})`);
console.log(`Altura: ${bySource.height} con height, ${bySource.levels} con pisos, ${bySource.default} por defecto`);
console.log(`Guardado en ${output}`);
