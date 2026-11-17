import { storage } from 'wxt/utils/storage';
import type { AutoOpenStatus } from './runner';
import type { PackInfo } from './planner';

export const autoOpenStatusItem = storage.defineItem<AutoOpenStatus | null>(
  'local:autoOpenStatus',
  {
    fallback: null,
  },
);

export const autoOpenLogItem = storage.defineItem<{ t: number; m: string }[]>('local:autoOpenLog', {
  fallback: [],
});

/** Catalogue public des boosters, gardé pour que le popup liste les noms sans onglet Kyara. */
export const packCatalogItem = storage.defineItem<PackInfo[]>('local:packCatalog', {
  fallback: [],
});

const LOG_MAX = 80;

let logChain: Promise<unknown> = Promise.resolve();

export function appendAutoOpenLog(message: string, now: () => number = Date.now): Promise<void> {
  const entry = { t: now(), m: message };
  logChain = logChain
    .then(async () => {
      const list = await autoOpenLogItem.getValue();
      await autoOpenLogItem.setValue([...list, entry].slice(-LOG_MAX));
    })
    .catch(() => undefined);
  return logChain as Promise<void>;
}

/** Attente interrompue tout de suite quand le signal est annulé. */
export function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, Math.max(0, ms));
    signal.addEventListener('abort', done, { once: true });
  });
}
