import type { ChunkEntry } from './chunks';
import type { Building } from './types';

export interface ChunkProgress {
  /** Zonas ya cargadas. */
  loaded: number;
  /** Zonas que faltan: en cola o descargándose. */
  pending: number;
  /** Zonas que fallaron y todavía no se reintentaron. */
  failed: number;
}

export interface ChunkLoaderOptions {
  /** Descarga y normaliza los edificios de una zona. */
  fetchChunk: (entry: ChunkEntry, signal: AbortSignal) => Promise<Building[]>;
  onChunk: (entry: ChunkEntry, buildings: Building[]) => void;
  onProgress?: (progress: ChunkProgress) => void;
  onError?: (entry: ChunkEntry, error: unknown) => void;
  /** Descargas simultáneas. */
  concurrency?: number;
  /** Una zona que falló no se reintenta antes de este tiempo. */
  retryAfterMs?: number;
  now?: () => number;
}

/**
 * Baja zonas de edificios de a pocas a la vez, en el orden en que se piden.
 * Cada `request` reemplaza la cola de espera: si el usuario ya se movió a otro
 * lado, las zonas que quedaron atrás no se descargan. Lo que ya está
 * descargándose termina, y nunca se baja dos veces la misma zona.
 */
export class ChunkLoader {
  private readonly loaded = new Set<string>();
  private readonly inFlight = new Map<string, AbortController>();
  private readonly failedAt = new Map<string, number>();
  private queue: ChunkEntry[] = [];
  private disposed = false;
  private readonly concurrency: number;
  private readonly retryAfterMs: number;
  private readonly now: () => number;

  constructor(private readonly options: ChunkLoaderOptions) {
    this.concurrency = Math.max(1, options.concurrency ?? 4);
    this.retryAfterMs = options.retryAfterMs ?? 10_000;
    this.now = options.now ?? Date.now;
  }

  /** Pide estas zonas, de la más a la menos prioritaria. */
  request(entries: ChunkEntry[]): void {
    if (this.disposed) return;
    const now = this.now();
    this.queue = entries.filter((entry) => {
      if (this.loaded.has(entry.id) || this.inFlight.has(entry.id)) return false;
      const failed = this.failedAt.get(entry.id);
      return failed === undefined || now - failed >= this.retryAfterMs;
    });
    this.pump();
    this.report();
  }

  /** Cancela lo que está en curso y descarta la cola. */
  dispose(): void {
    this.disposed = true;
    this.queue = [];
    for (const controller of this.inFlight.values()) controller.abort();
    this.inFlight.clear();
  }

  private pump(): void {
    while (this.inFlight.size < this.concurrency) {
      const entry = this.queue.shift();
      if (!entry) return;
      this.start(entry);
    }
  }

  private start(entry: ChunkEntry): void {
    const controller = new AbortController();
    this.inFlight.set(entry.id, controller);

    const download = async () => this.options.fetchChunk(entry, controller.signal);
    download()
      .then(
        (buildings) => {
          this.inFlight.delete(entry.id);
          if (this.disposed) return;
          this.loaded.add(entry.id);
          this.failedAt.delete(entry.id);
          try {
            this.options.onChunk(entry, buildings);
          } catch (error) {
            this.options.onError?.(entry, error);
          }
        },
        (error: unknown) => {
          this.inFlight.delete(entry.id);
          if (this.disposed || controller.signal.aborted) return;
          this.failedAt.set(entry.id, this.now());
          this.options.onError?.(entry, error);
        },
      )
      .finally(() => {
        if (this.disposed) return;
        this.pump();
        this.report();
      });
  }

  private report(): void {
    this.options.onProgress?.({
      loaded: this.loaded.size,
      pending: this.queue.length + this.inFlight.size,
      failed: this.failedAt.size,
    });
  }
}
