import type { ApiClient } from '../api';
import { getCatalog } from '../catalog';
import {
  adviseSell,
  bestBid,
  fetchBuyOrders,
  fetchCompetition,
  fetchMarketConfig,
  fetchPriceSnapshot,
  type MarketConfig,
  type SellAdvice,
} from './advisor';
import { getMarket } from './market';
import { fetchOwned } from './trades';

/**
 * Analyse **complète** des doublons, comme Kyara Helper : toutes les cartes en double de la
 * collection (hors protégées), une par une, avec médianes, concurrence et ordres d'achat.
 * Aucune écriture : le recyclage reste une action explicite du panneau.
 */

export type ScanApi = Pick<ApiClient, 'request'>;

export interface DuplicateRow {
  id: number;
  name: string;
  rarity: string;
  /** Exemplaires au-delà du premier. */
  copies: number;
  /** Copies déjà en vente (annonces actives ou verrouillées). */
  listed: number;
  /** Copies réellement recyclables : `copies - listed`. */
  spare: number;
  advice: SellAdvice | null;
  error: string | null;
}

export interface DuplicateScanResult {
  rows: DuplicateRow[];
  total: number;
  errors: number;
  config: MarketConfig;
  /** Interrompu par le signal avant la fin. */
  stopped: boolean;
}

export interface DuplicateScanOptions {
  signal?: AbortSignal;
  /** Pause entre deux cartes, en plus de l'écart déjà appliqué par le client API. */
  pauseMs?: number;
  wait?: (ms: number) => Promise<void>;
  onProgress?: (done: number, total: number) => void;
  onRow?: (row: DuplicateRow) => void;
}

const RARITY_ORDER: Record<string, number> = { C: 1, U: 2, R: 3, E: 4, L: 5, M: 6 };

const paused = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

/** Une ligne par carte en double, les plus rares d'abord (comme la liste de Kyara Doublons). */
export function duplicateBase(
  owned: ReadonlyMap<number, number>,
  blocked: ReadonlySet<number>,
  listed: ReadonlyMap<number, number>,
  meta: ReadonlyMap<number, { name?: string; rarity?: string }>,
): DuplicateRow[] {
  const rows: DuplicateRow[] = [];
  for (const [id, qty] of owned) {
    if (qty <= 1 || blocked.has(id)) continue;
    const card = meta.get(id);
    const copies = qty - 1;
    const onSale = Math.max(0, Math.min(copies, listed.get(id) ?? 0));
    rows.push({
      id,
      name: card?.name ?? `Carte #${id}`,
      rarity: String(card?.rarity ?? '').toUpperCase(),
      copies,
      listed: onSale,
      spare: Math.max(0, copies - onSale),
      advice: null,
      error: null,
    });
  }
  return rows.sort(
    (a, b) =>
      (RARITY_ORDER[b.rarity] ?? 0) - (RARITY_ORDER[a.rarity] ?? 0) ||
      b.copies - a.copies ||
      a.name.localeCompare(b.name, 'fr'),
  );
}

export async function scanDuplicates(
  api: ScanApi,
  options: DuplicateScanOptions = {},
): Promise<DuplicateScanResult> {
  const wait = options.wait ?? paused;
  const pauseMs = Math.max(0, options.pauseMs ?? 0);
  const [catalog, collection, market, config] = await Promise.all([
    getCatalog(api),
    fetchOwned(api),
    getMarket(api),
    fetchMarketConfig(api),
  ]);
  const meta = new Map<number, { name?: string; rarity?: string }>();
  for (const card of catalog) {
    const id = Number(card.id);
    if (Number.isSafeInteger(id)) meta.set(id, { name: card.name, rarity: card.rarity });
  }
  const listed = new Map<number, number>();
  for (const listing of market.active) {
    listed.set(listing.characterId, (listed.get(listing.characterId) ?? 0) + 1);
  }

  const rows = duplicateBase(collection.owned, collection.blocked, listed, meta);
  const total = rows.length;
  let done = 0;
  let errors = 0;
  let stopped = false;
  options.onProgress?.(0, total);

  for (const row of rows) {
    if (options.signal?.aborted) {
      stopped = true;
      break;
    }
    try {
      const [prices, competition, orders] = await Promise.all([
        fetchPriceSnapshot(api, row.id),
        fetchCompetition(api, row.id),
        fetchBuyOrders(api, row.id),
      ]);
      const activeListings =
        competition.activeListings === null
          ? null
          : Math.max(0, competition.activeListings - row.listed);
      row.advice = adviseSell({
        rarity: row.rarity,
        prices,
        lowestAsk: competition.lowestAsk,
        activeListings,
        bestBid: bestBid(orders),
        recycle: config.recycle,
        rules: config.rules,
      });
    } catch (error) {
      errors += 1;
      row.error = error instanceof Error ? error.message : String(error);
    }
    done += 1;
    options.onRow?.(row);
    options.onProgress?.(done, total);
    if (pauseMs > 0 && !options.signal?.aborted) await wait(pauseMs);
  }

  return { rows, total, errors, config, stopped };
}

/** Copies conseillées « recycler », en gardant un exemplaire. */
export function recyclable(row: DuplicateRow): number {
  return row.spare > 0 && row.advice?.verdict === 'recycler' ? row.spare : 0;
}

/** Chakra récupéré si toutes les copies conseillées « recycler » partent. */
export function recyclableChakra(rows: readonly DuplicateRow[]): number {
  return rows.reduce((sum, row) => sum + recyclable(row) * (row.advice?.recycle ?? 0), 0);
}
