import { createHash } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  buildManifest,
  chunkCellBbox,
  createChunkGrid,
  splitIntoChunks,
  unionBounds,
  type ChunkEntry,
  type ChunkManifest,
  type ChunkableFeature,
  type DataSourceInfo,
} from '../../src/buildings/chunks';
import type { AreaConfig } from '../../src/config';
import { serializeFeatureCollection } from './writeGeoJSON';

/** Lado de cada zona. Con ~2.000 volúmenes por zona en Palermo, cada archivo pesa unos 750 KB. */
export const DEFAULT_CHUNK_SIZE_M = 500;

/**
 * Escribe los edificios como un dataset por zonas:
 *
 *   <outputDir>/index.json            índice: qué zonas hay y qué cubre cada una
 *   <outputDir>/tiles/<x>_<y>.geojson una zona
 *
 * Es lo que se sube tal cual a un servidor estático o CDN. Solo toca `index.json`
 * y `tiles/` dentro de `outputDir`.
 */
export async function writeChunkedDataset(options: {
  outputDir: string;
  area: AreaConfig;
  source: DataSourceInfo;
  features: ChunkableFeature[];
  chunkSizeM?: number;
}): Promise<{ manifest: ChunkManifest; bytes: number }> {
  const { outputDir, area, source, features } = options;
  const chunkSizeM = options.chunkSizeM ?? DEFAULT_CHUNK_SIZE_M;
  const grid = createChunkGrid(area.bbox, chunkSizeM);
  const groups = [...splitIntoChunks(features, grid)].sort(([a], [b]) => a.localeCompare(b));

  // Sin índice, el dataset a medio escribir no se puede usar por error.
  await rm(join(outputDir, 'index.json'), { force: true });
  await rm(join(outputDir, 'tiles'), { recursive: true, force: true });
  await mkdir(join(outputDir, 'tiles'), { recursive: true });

  const hash = createHash('sha1');
  const entries: ChunkEntry[] = [];
  let bytes = 0;

  for (const [id, group] of groups) {
    const bbox = unionBounds(group.features) ?? chunkCellBbox(grid, group.cell);
    const content = serializeFeatureCollection({ bbox, metadata: { area: area.id, chunk: id } }, group.features);
    hash.update(id).update(content);
    bytes += Buffer.byteLength(content);

    const file = `tiles/${id}.geojson`;
    await writeFile(join(outputDir, file), content);
    entries.push({ id, file, bbox, count: group.features.length });
  }

  const manifest = buildManifest({
    area: area.id,
    bbox: area.bbox,
    chunkSizeM,
    source,
    dataVersion: hash.digest('hex').slice(0, 12),
    generatedAt: new Date().toISOString(),
    chunks: entries,
  });
  await writeFile(join(outputDir, 'index.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return { manifest, bytes };
}
