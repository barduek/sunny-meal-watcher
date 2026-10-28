/**
 * Genera los edificios de la zona a partir del dataset "Tejido Urbano" del
 * GCBA, divididos en zonas de 500 m más un índice (ver scripts/lib/chunkedDataset.ts). Uso:
 *
 *   npm run fetch:buildings                              # descarga (1 GB, queda en .cache/) y filtra
 *   npm run fetch:buildings -- --input ruta/tejido.geojson
 *   npm run fetch:buildings -- --output otra/carpeta
 *
 * Por defecto escribe en public/<dataPath> (src/config.ts), que está en .gitignore.
 * El archivo original trae un feature por línea (formato de GDAL), así que se
 * lee en streaming sin cargar el GB entero en memoria.
 */
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdir, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { TEJIDO_URBANO, tejidoToBuildingFeature, type TejidoBuildingFeature } from '../src/buildings/gcba';
import { PALERMO } from '../src/config';
import { writeChunkedDataset } from './lib/chunkedDataset';

const CACHE_FILE = resolve('.cache/gcba-tejido.geojson');

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function download(url: string, destination: string): Promise<void> {
  console.log(`Descargando ${url} (~1 GB, puede tardar unos minutos)…`);
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`Descarga fallida: HTTP ${response.status}`);
  await mkdir(resolve('.cache'), { recursive: true });
  const partial = `${destination}.part`;
  await pipeline(Readable.fromWeb(response.body as WebReadableStream), createWriteStream(partial));
  await rename(partial, destination);
}

const area = PALERMO;
const input = argument('input') ?? CACHE_FILE;
const output = resolve(argument('output') ?? `public/${area.dataPath}`);

if (!argument('input') && !existsSync(CACHE_FILE)) await download(TEJIDO_URBANO.downloadUrl, CACHE_FILE);

console.log(`Filtrando volúmenes de ${area.name} (bbox ${area.bbox.join(', ')}) desde ${input}…`);
const features: TejidoBuildingFeature[] = [];
let read = 0;
let unreadable = 0;

for await (const rawLine of createInterface({ input: createReadStream(input), crlfDelay: Infinity })) {
  const line = rawLine.trim().replace(/,$/, '');
  if (!line.startsWith('{') || !line.includes('"Feature"')) continue;
  read += 1;
  try {
    const feature = tejidoToBuildingFeature(JSON.parse(line), area.bbox);
    if (feature) features.push(feature);
  } catch {
    unreadable += 1;
  }
}

// Si el formato del archivo cambia (por ejemplo, sin un feature por línea), mejor fallar que generar un snapshot vacío.
if (read === 0 || unreadable > read * 0.01) {
  throw new Error(`No se pudo leer el archivo como un feature por línea (${read} leídos, ${unreadable} con error)`);
}

const { manifest, bytes } = await writeChunkedDataset({ outputDir: output, area, source: TEJIDO_URBANO.source, features });

console.log(`Volúmenes: ${features.length} dentro del bbox (de ${read} en el dataset)`);
console.log(`Zonas: ${manifest.chunks.length} (${(bytes / 1e6).toFixed(1)} MB en total, versión ${manifest.dataVersion})`);
console.log(`Guardado en ${output}`);
