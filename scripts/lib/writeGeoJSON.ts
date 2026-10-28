import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * Serializa una FeatureCollection con un feature por línea: el archivo queda
 * legible y los diffs son chicos. `head` lleva `bbox` y `metadata`.
 */
export function serializeFeatureCollection(head: Record<string, unknown>, features: unknown[]): string {
  const header = JSON.stringify({ type: 'FeatureCollection', ...head }).slice(0, -1);
  const body = features.map((feature) => JSON.stringify(feature)).join(',\n');
  return `${header},"features":[\n${body}\n]}\n`;
}

export async function writeFeatureCollection(path: string, head: Record<string, unknown>, features: unknown[]): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, serializeFeatureCollection(head, features));
}
