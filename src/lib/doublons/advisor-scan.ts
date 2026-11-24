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
  /** Cartes analysées en même temps (2 par défaut, borné à 4). */
  concurrency?: number;
  /** Lignes d'une analyse précédente, reprises sans relire les cartes encore fraîches. */
  previous?: readonly DuplicateRow[];
  /** Date de l'analyse précédente : au-delà de `freshMs`, rien n'est repris. */
  previousAt?: number;
  /** Fraîcheur acceptée pour une ligne reprise (5 min par défaut). */
  freshMs?: number;
  /** Horloge injectable, pour la fraîcheur de la reprise. */
  now?: () => number;
}

/** Cartes traitées en parallèle : deux suffisent à masquer la latence sans rafale. */
export const SCAN_CONCURRENCY = 2;
/** Reprise : une ligne analysée il y a moins de cinq minutes n'est pas relue. */
export const SCAN_FRESH_MS = 5 * 60_000;

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
    // Une annonce peut engager plusieurs exemplaires : les compter tous, sinon `spare`
    // proposerait de remettre en vente une copie déjà en ligne.
    const qty = Math.max(1, Math.trunc(Number(listing.qty ?? 1)) || 1);
    listed.set(listing.characterId, (listed.get(listing.characterId) ?? 0) + qty);
  }

  const rows = duplicateBase(collection.owned, collection.blocked, listed, meta);
  const total = rows.length;
  const now = options.now ?? Date.now;
  const previousAt = options.previousAt ?? 0;
  const freshMs = options.freshMs ?? SCAN_FRESH_MS;
  const concurrency = Math.max(1, Math.min(4, Math.trunc(options.concurrency ?? SCAN_CONCURRENCY)));
  let done = 0;
  let errors = 0;
  let stopped = false;
  options.onProgress?.(0, total);

  // Reprise : une ligne analysée il y a moins de cinq minutes est reprise telle quelle,
  // donc une analyse interrompue ne relit pas ce qu'elle avait déjà chiffré.
  const reusable = new Map<number, DuplicateRow>();
  if (options.previous?.length && previousAt > 0 && now() - previousAt <= freshMs) {
    for (const row of options.previous) {
      if (row.advice && !row.error) reusable.set(row.id, row);
    }
  }
  const ready = new Array<boolean>(rows.length).fill(false);
  for (const [index, row] of rows.entries()) {
    const cached = reusable.get(row.id);
    if (!cached) continue;
    row.advice = cached.advice;
    ready[index] = true;
  }

  // Les lignes sortent toujours dans l'ordre de la liste, même analysées en parallèle.
  let flush = 0;
  const emit = (): void => {
    while (flush < rows.length && ready[flush]) {
      const row = rows[flush];
      if (row) options.onRow?.(row);
      done += 1;
      options.onProgress?.(done, total);
      flush += 1;
    }
  };
  emit();

  let next = 0;
  const analyze = async (row: DuplicateRow): Promise<void> => {
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
  };

  const worker = async (): Promise<void> => {
    while (!stopped) {
      if (options.signal?.aborted) {
        stopped = true;
        return;
      }
      const index = next;
      next += 1;
      if (index >= rows.length) return;
      const row = rows[index];
      if (!row || ready[index]) continue;
      try {
        await analyze(row);
      } catch (error) {
        errors += 1;
        row.error = error instanceof Error ? error.message : String(error);
      }
      ready[index] = true;
      emit();
      if (pauseMs > 0 && !options.signal?.aborted) await wait(pauseMs);
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  if (options.signal?.aborted) stopped = true;

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
