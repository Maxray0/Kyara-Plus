import { storage } from 'wxt/utils/storage';
import type { SellAdvice } from './advisor';
import type { DuplicateRow } from './advisor-scan';

/**
 * Sauvegarde locale de l'analyse « Mes doublons » : elle sert d'affichage immédiat à
 * l'ouverture, puis l'analyse complète tourne en arrière-plan pour rafraîchir les prix,
 * les ordres et ajouter les nouvelles cartes. Rien n'est envoyé au site.
 */

export interface CachedDuplicate {
  row: DuplicateRow;
  done: boolean;
  doneLabel: string;
}

export interface DuplicateCache {
  at: number;
  rows: CachedDuplicate[];
}

export const duplicateCacheItem = storage.defineItem<unknown>('local:duplicateScan', {
  fallback: null,
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

const integer = (value: unknown): number => {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
};

function cleanAdvice(value: unknown): SellAdvice | null {
  if (!isRecord(value)) return null;
  const verdict = value.verdict;
  if (verdict !== 'vendre' && verdict !== 'ordre' && verdict !== 'recycler') return null;
  const optional = (key: string): number | undefined => {
    const number = Number(value[key]);
    return Number.isFinite(number) ? number : undefined;
  };
  return {
    verdict,
    why: text(value.why),
    recycle: Number(value.recycle) || 0,
    ref: optional('ref') ?? null,
    sales7d: Number(value.sales7d) || 0,
    lowestAsk: optional('lowestAsk') ?? null,
    activeListings: optional('activeListings') ?? null,
    ...(optional('bestBid') !== undefined ? { bestBid: optional('bestBid') } : {}),
    ...(optional('price') !== undefined ? { price: optional('price') } : {}),
    ...(optional('net') !== undefined ? { net: optional('net') } : {}),
    ...(optional('bidNet') !== undefined ? { bidNet: optional('bidNet') } : {}),
  };
}

function cleanRow(value: unknown): DuplicateRow | null {
  if (!isRecord(value)) return null;
  const id = integer(value.id);
  const name = text(value.name).trim();
  if (!id || !name) return null;
  return {
    id,
    name,
    rarity: text(value.rarity),
    copies: Math.max(0, Number(value.copies) || 0),
    listed: Math.max(0, Number(value.listed) || 0),
    spare: Math.max(0, Number(value.spare) || 0),
    advice: cleanAdvice(value.advice),
    error: typeof value.error === 'string' ? value.error : null,
  };
}

/** Relit la sauvegarde sans jamais faire confiance à sa forme. */
export function normalizeDuplicateCache(raw: unknown): DuplicateCache | null {
  if (!isRecord(raw)) return null;
  const at = Number(raw.at);
  if (!Number.isFinite(at) || at <= 0) return null;
  const rows: CachedDuplicate[] = [];
  const seen = new Set<number>();
  for (const item of Array.isArray(raw.rows) ? raw.rows : []) {
    if (!isRecord(item)) continue;
    const row = cleanRow(item.row);
    if (!row || seen.has(row.id)) continue;
    seen.add(row.id);
    rows.push({
      row,
      done: item.done === true,
      doneLabel: text(item.doneLabel).slice(0, 80),
    });
  }
  return { at, rows };
}

export function duplicateCachePayload(
  rows: readonly CachedDuplicate[],
  now = Date.now(),
): DuplicateCache {
  return { at: now, rows: [...rows] };
}
