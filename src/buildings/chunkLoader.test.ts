import { describe, expect, it } from 'vitest';
import { ChunkLoader, type ChunkProgress } from './chunkLoader';
import type { ChunkEntry } from './chunks';
import type { Building } from './types';

const entry = (id: string): ChunkEntry => ({ id, file: `tiles/${id}.geojson`, bbox: [0, 0, 1, 1], count: 1 });
const building = (id: string): Building => ({ id, footprint: [], height: 9, heightSource: 'height' });

/** Descargas controladas a mano: el test decide cuándo termina o falla cada una. */
function setup(options: { concurrency?: number; retryAfterMs?: number } = {}) {
  const pending = new Map<string, { resolve: (b: Building[]) => void; reject: (e: unknown) => void; signal: AbortSignal }>();
  const started: string[] = [];
  const loaded: string[] = [];
  const errors: string[] = [];
  const progress: ChunkProgress[] = [];
  let time = 0;

  const loader = new ChunkLoader({
    fetchChunk: (chunk, signal) =>
      new Promise((resolve, reject) => {
        started.push(chunk.id);
        pending.set(chunk.id, { resolve, reject, signal });
      }),
    onChunk: (chunk) => loaded.push(chunk.id),
    onError: (chunk) => errors.push(chunk.id),
    onProgress: (p) => progress.push(p),
    now: () => time,
    ...options,
  });

  return {
    loader,
    started,
    loaded,
    errors,
    progress,
    advance: (ms: number) => (time += ms),
    finish: async (id: string) => {
      pending.get(id)?.resolve([building(id)]);
      await flush();
    },
    fail: async (id: string) => {
      pending.get(id)?.reject(new Error('sin red'));
      await flush();
    },
    signalOf: (id: string) => pending.get(id)?.signal,
  };
}

/** Deja correr las promesas pendientes. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('ChunkLoader', () => {
  it('descarga de a `concurrency` zonas y sigue con la cola cuando se libera un lugar', async () => {
    const t = setup({ concurrency: 2 });
    t.loader.request([entry('a'), entry('b'), entry('c')]);
    expect(t.started).toEqual(['a', 'b']);

    await t.finish('a');
    expect(t.started).toEqual(['a', 'b', 'c']);
  });

  it('respeta el orden de prioridad que se pidió', async () => {
    const t = setup({ concurrency: 1 });
    t.loader.request([entry('cerca'), entry('medio'), entry('lejos')]);
    await t.finish('cerca');
    await t.finish('medio');
    await t.finish('lejos');
    expect(t.loaded).toEqual(['cerca', 'medio', 'lejos']);
  });

  it('no vuelve a pedir zonas cargadas ni en curso', async () => {
    const t = setup({ concurrency: 1 });
    t.loader.request([entry('a'), entry('b')]);
    t.loader.request([entry('a'), entry('b')]); // 'a' en curso, 'b' en cola
    expect(t.started).toEqual(['a']);

    await t.finish('a');
    t.loader.request([entry('a'), entry('b')]); // 'a' ya cargada
    await t.finish('b');
    expect(t.started).toEqual(['a', 'b']);
    expect(t.loaded).toEqual(['a', 'b']);
  });

  it('cada pedido reemplaza la cola: las zonas que quedaron atrás no se descargan', async () => {
    const t = setup({ concurrency: 1 });
    t.loader.request([entry('a'), entry('b'), entry('c')]);
    t.loader.request([entry('c'), entry('d')]); // el usuario se movió; 'b' ya no importa

    await t.finish('a');
    await t.finish('c');
    await t.finish('d');
    expect(t.started).toEqual(['a', 'c', 'd']);
  });

  it('informa el avance: cargadas, pendientes y fallidas', async () => {
    const t = setup({ concurrency: 1 });
    t.loader.request([entry('a'), entry('b')]);
    expect(t.progress.at(-1)).toEqual({ loaded: 0, pending: 2, failed: 0 });

    await t.finish('a');
    expect(t.progress.at(-1)).toEqual({ loaded: 1, pending: 1, failed: 0 });

    await t.finish('b');
    expect(t.progress.at(-1)).toEqual({ loaded: 2, pending: 0, failed: 0 });
  });

  it('una zona que falla se avisa y no se reintenta hasta pasado el tiempo de espera', async () => {
    const t = setup({ concurrency: 1, retryAfterMs: 10_000 });
    t.loader.request([entry('a')]);
    await t.fail('a');
    expect(t.errors).toEqual(['a']);
    expect(t.progress.at(-1)).toEqual({ loaded: 0, pending: 0, failed: 1 });

    t.advance(5_000);
    t.loader.request([entry('a')]);
    expect(t.started).toEqual(['a']); // todavía no

    t.advance(6_000);
    t.loader.request([entry('a')]);
    expect(t.started).toEqual(['a', 'a']); // reintento
  });

  it('un fallo no frena las demás zonas', async () => {
    const t = setup({ concurrency: 1 });
    t.loader.request([entry('a'), entry('b')]);
    await t.fail('a');
    await t.finish('b');
    expect(t.loaded).toEqual(['b']);
  });

  it('si el callback de una zona lanza un error, se informa y la carga sigue', async () => {
    const errors: string[] = [];
    const loader = new ChunkLoader({
      fetchChunk: async (chunk) => [building(chunk.id)],
      onChunk: () => {
        throw new Error('falló al dibujar');
      },
      onError: (chunk) => errors.push(chunk.id),
      concurrency: 1,
    });
    loader.request([entry('a'), entry('b')]);
    await flush();
    expect(errors).toEqual(['a', 'b']);
  });

  it('dispose cancela las descargas en curso y no entrega nada más', async () => {
    const t = setup({ concurrency: 1 });
    t.loader.request([entry('a'), entry('b')]);
    const signal = t.signalOf('a');

    t.loader.dispose();
    expect(signal?.aborted).toBe(true);

    await t.finish('a');
    expect(t.loaded).toEqual([]);
    expect(t.started).toEqual(['a']);
  });
});
