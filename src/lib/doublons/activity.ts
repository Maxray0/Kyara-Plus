import { storage } from 'wxt/utils/storage';
import { getMarket, type Api } from './market';
import { getSales, summarizeSales, type Sale, type SalesSummary } from './sales';
import type { LogKind } from './sell';

export interface ActivityEntry {
  /** Instant de l'événement. */
  t: number;
  text: string;
  kind: LogKind;
}

export const ACTIVITY_MAX = 100;

/** Journal partagé par la page Doublons, le panneau et la vente automatique. */
export const activityItem = storage.defineItem<ActivityEntry[]>('local:activity', {
  fallback: [],
});

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const isKind = (value: unknown): value is LogKind =>
  value === 'info' || value === 'warn' || value === 'sale';

function cleanActivity(value: unknown): ActivityEntry[] {
  if (!Array.isArray(value)) return [];
  const entries: ActivityEntry[] = [];
  for (const item of value) {
    const raw = asRecord(item);
    const t = Number(raw.t);
    const message = typeof raw.text === 'string' ? raw.text : '';
    if (!Number.isFinite(t) || t <= 0 || !message) continue;
    entries.push({ t, text: message, kind: isKind(raw.kind) ? raw.kind : 'info' });
  }
  return entries.slice(-ACTIVITY_MAX);
}

let chain: Promise<void> = Promise.resolve();

/** Ajoute une entrée au journal, en gardant les 100 plus récentes. */
export function appendActivity(
  message: string,
  kind: LogKind = 'info',
  now = Date.now(),
): Promise<void> {
  chain = chain
    .then(async () => {
      const entries = cleanActivity(await activityItem.getValue());
      await activityItem.setValue(
        [...entries, { t: now, text: message, kind }].slice(-ACTIVITY_MAX),
      );
    })
    .catch(() => undefined);
  return chain;
}

/** Journal trié du plus ancien au plus récent. */
export async function getActivity(): Promise<ActivityEntry[]> {
  try {
    return cleanActivity(await activityItem.getValue());
  } catch {
    return [];
  }
}

export interface ActivitySnapshot {
  sales: Sale[];
  summary: SalesSummary;
}

/** Résumé local, sans appel réseau. */
export async function loadActivitySnapshot(now = Date.now()): Promise<ActivitySnapshot> {
  const sales = await getSales(now);
  return { sales, summary: summarizeSales(sales, now) };
}

/** Relit le marché (les ventes terminées sont enregistrées par `getMarket`) puis le résumé. */
export async function refreshActivitySnapshot(
  api: Api,
  now = Date.now(),
): Promise<ActivitySnapshot> {
  await getMarket(api, now);
  return loadActivitySnapshot(now);
}
