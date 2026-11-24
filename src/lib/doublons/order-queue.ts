import { storage } from 'wxt/utils/storage';
import type { ApiClient } from '../api';
import { isCircuitFailure } from '../circuit-breaker';
import type { Settings } from '../settings';
import type { StopReason } from '../supervisor';
import { buyPlanItem, normalizeBuyPlan, type BuyPlan } from './buy-plan';
import {
  BUY_ORDER_QTY_MAX,
  buyOrdersItem,
  normalizeBuyOrders,
  placeBuyOrder,
  type BuyOrderDraft,
  type BuyOrderEntry,
  type BuyOrders,
  type PlaceOrderResult,
} from './buy-orders';
import { readMarketOrders } from './my-orders';
import { fetchPriceSnapshot } from './advisor';

/**
 * File d'ordres d'achat propre à l'extension. Le site n'accepte qu'un nombre limité
 * d'ordres ouverts (`marketLimits.buyOrders`, 20 sans abonnement) et refuse le POST
 * au-delà. La file garde donc les cartes en local et les envoie une par une dès qu'une
 * place se libère (ordre rempli, annulé ou expiré), sans jamais contourner l'API du site.
 */

/** Médiane 7 j du marché, 30 j à défaut ; `null` si la lecture échoue. */
async function marketMedian(
  api: Pick<ApiClient, 'request'>,
  characterId: number,
): Promise<number | null> {
  const snapshot = await fetchPriceSnapshot(api, characterId).catch(() => null);
  return snapshot?.median7d ?? snapshot?.median30d ?? null;
}

export const SITE_ORDER_LIMIT_FALLBACK = 20;
export const ORDER_QUEUE_MAX = 500;
/** Délai avant de retenter une entrée refusée. */
export const ORDER_QUEUE_ENTRY_RETRY_MS = 5 * 60_000;
/** Au-delà, l'ordre préparé est signalé comme ancien dans le panneau. */
export const ORDER_QUEUE_STALE_MS = 7 * 24 * 3_600_000;
/** Refus consécutifs qui arrêtent la passe, pour ne pas marteler le site. */
export const ORDER_QUEUE_MAX_FAILURES = 3;
/** Écart au-dessus de la médiane au-delà duquel l'ordre est mis en attente de vérification. */
export const ORDER_QUEUE_DRIFT_RATIO = 0.9;

export interface QueuedOrder {
  characterId: number;
  name: string | null;
  price: number;
  qty: number;
  addedAt: number;
  /** Médiane connue au moment de la mise en file, pour trier par marge. */
  median: number | null;
  /** Dernier refus du site ou de la vérification, affiché sur la ligne. */
  error: string | null;
  /** Instant avant lequel l'entrée n'est pas retentée. */
  retryAt: number;
}

export interface OrderQueue {
  entries: QueuedOrder[];
}

export const orderQueueItem = storage.defineItem<OrderQueue>('local:orderQueue', {
  fallback: { entries: [] },
  version: 1,
});

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

export function normalizeOrderQueue(raw: unknown): OrderQueue {
  const source = record(raw);
  const rows = Array.isArray(source.entries) ? source.entries : [];
  const entries: QueuedOrder[] = [];
  const seen = new Set<number>();
  for (const row of rows) {
    const entry = record(row);
    const characterId = Number(entry.characterId);
    const price = Number(entry.price);
    const qty = Number(entry.qty);
    if (!Number.isSafeInteger(characterId) || characterId < 1 || seen.has(characterId)) continue;
    if (!Number.isSafeInteger(price) || price < 1) continue;
    if (!Number.isSafeInteger(qty) || qty < 1 || qty > BUY_ORDER_QTY_MAX) continue;
    seen.add(characterId);
    const median = Number(entry.median);
    const retryAt = Number(entry.retryAt);
    entries.push({
      characterId,
      name: typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : null,
      price,
      qty,
      addedAt: Number(entry.addedAt) > 0 ? Number(entry.addedAt) : 0,
      median: Number.isFinite(median) && median > 0 ? median : null,
      error: typeof entry.error === 'string' && entry.error.trim() ? entry.error.trim().slice(0, 160) : null,
      retryAt: Number.isFinite(retryAt) && retryAt > 0 ? retryAt : 0,
    });
  }
  return { entries: entries.slice(-ORDER_QUEUE_MAX) };
}

/** Marge d'une entrée : médiane connue moins prix demandé, `null` sans médiane. */
export function queueMargin(entry: QueuedOrder): number | null {
  return entry.median === null ? null : entry.median - entry.price;
}

/** Les meilleures marges d'abord, les cartes sans médiane ensuite, l'ajout le plus ancien avant. */
export function sortQueueByMargin(raw: OrderQueue): OrderQueue {
  const entries = [...normalizeOrderQueue(raw).entries];
  entries.sort((a, b) => {
    const ma = queueMargin(a);
    const mb = queueMargin(b);
    if (ma === null && mb === null) return a.addedAt - b.addedAt;
    if (ma === null) return 1;
    if (mb === null) return -1;
    return mb - ma || a.addedAt - b.addedAt;
  });
  return { entries };
}

/** Déplace une entrée dans la file (réordonnancement manuel), sans changer ses valeurs. */
export function moveQueuedOrder(raw: OrderQueue, characterId: number, delta: number): OrderQueue {
  const entries = [...normalizeOrderQueue(raw).entries];
  const index = entries.findIndex((entry) => entry.characterId === characterId);
  if (index < 0) return { entries };
  const target = Math.max(0, Math.min(entries.length - 1, index + Math.trunc(delta)));
  if (target === index) return { entries };
  const [entry] = entries.splice(index, 1);
  if (entry) entries.splice(target, 0, entry);
  return { entries };
}

/** Note un refus sur une entrée sans la retirer de la file, avec son délai de reprise. */
export function markQueueEntry(
  raw: OrderQueue,
  characterId: number,
  patch: { error?: string | null; retryAt?: number; median?: number | null; price?: number },
): OrderQueue {
  const entries = normalizeOrderQueue(raw).entries.map((entry) =>
    entry.characterId === characterId ? { ...entry, ...patch } : entry,
  );
  return { entries };
}

/** Ancienneté et dérive affichées sur une ligne, sans rien bloquer ici. */
export function queueWarnings(entry: QueuedOrder, now = Date.now()): string[] {
  const warnings: string[] = [];
  if (entry.addedAt > 0 && now - entry.addedAt > ORDER_QUEUE_STALE_MS) {
    const days = Math.floor((now - entry.addedAt) / 86_400_000);
    warnings.push(`préparé il y a ${days} j`);
  }
  if (entry.median && entry.price > entry.median) {
    warnings.push(`au-dessus de la médiane (${Math.round((entry.price / entry.median - 1) * 100)} %)`);
  }
  if (entry.retryAt > now) warnings.push('retenté plus tard');
  return warnings;
}

/** Médiane descendue sous 90 % du prix préparé : l'ordre risque de payer trop cher. */
export function queuePriceDrift(entry: QueuedOrder, median: number | null): boolean {
  return median !== null && median > 0 && median < entry.price * ORDER_QUEUE_DRIFT_RATIO;
}

/** Ajoute ou met à jour les ordres préparés ; une carte déjà en file garde sa place. */
export function enqueueOrders(
  raw: OrderQueue,
  drafts: readonly BuyOrderDraft[],
  now = Date.now(),
  medians: ReadonlyMap<number, number> = new Map<number, number>(),
): OrderQueue {
  const queue = normalizeOrderQueue(raw);
  const byCard = new Map(queue.entries.map((entry) => [entry.characterId, entry] as const));
  for (const draft of drafts) {
    if (!Number.isSafeInteger(draft.characterId) || draft.characterId < 1) continue;
    if (!Number.isSafeInteger(draft.price) || draft.price < 1) continue;
    if (!Number.isSafeInteger(draft.qty) || draft.qty < 1) continue;
    const median = medians.get(draft.characterId);
    byCard.set(draft.characterId, {
      characterId: draft.characterId,
      name: draft.name ?? null,
      price: draft.price,
      qty: draft.qty,
      addedAt: now,
      median: Number.isFinite(median) && (median ?? 0) > 0 ? Number(median) : null,
      error: null,
      retryAt: 0,
    });
  }
  // L'ordre d'ajout est conservé : « Trier par marge » et les flèches de la ligne
  // changent l'ordre explicitement, une mise à jour de prix ne déplace pas une carte.
  return { entries: [...byCard.values()].slice(-ORDER_QUEUE_MAX) };
}

export function removeQueuedOrders(raw: OrderQueue, ids: readonly number[]): OrderQueue {
  const drop = new Set(ids);
  return { entries: normalizeOrderQueue(raw).entries.filter((entry) => !drop.has(entry.characterId)) };
}

export function queuedTotal(queue: OrderQueue): number {
  return normalizeOrderQueue(queue).entries.reduce((sum, entry) => sum + entry.price * entry.qty, 0);
}

/** Limite d'ordres ouverts annoncée par le compte (`marketLimits.buyOrders`). */
export function orderLimitFromMe(raw: unknown): number {
  const limits = record(record(raw).marketLimits);
  const limit = Number(limits.buyOrders);
  return Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : SITE_ORDER_LIMIT_FALLBACK;
}

export interface SiteOrderState {
  limit: number;
  open: number;
  free: number;
  chakra: number | null;
}

export async function readOrderLimit(api: Pick<ApiClient, 'request'>): Promise<number> {
  try {
    return orderLimitFromMe(await api.request<unknown>('/api/me', { timeoutMs: 15_000 }));
  } catch {
    return SITE_ORDER_LIMIT_FALLBACK;
  }
}

/** Limite, ordres déjà ouverts et places libres, lus sur le site. */
export async function readSiteOrderState(
  api: Pick<ApiClient, 'request'>,
): Promise<SiteOrderState> {
  const [me, market] = await Promise.all([
    api.request<unknown>('/api/me', { timeoutMs: 15_000 }),
    api.request<unknown>('/api/me/market'),
  ]);
  const limit = orderLimitFromMe(me);
  const open = readMarketOrders(market).open.length;
  const chakra = Number(record(me).chakra);
  return {
    limit,
    open,
    free: Math.max(0, limit - open),
    chakra: Number.isFinite(chakra) ? chakra : null,
  };
}

export interface ProcessQueueOptions {
  plan?: BuyPlan;
  /** Historique local des ordres, pour le plafond du jour (lecture/écriture injectables). */
  entries?: readonly BuyOrderEntry[];
  now?: number;
  gapMs?: number;
  wait?: (ms: number) => Promise<void>;
  /** État du site déjà lu, pour éviter deux requêtes de plus. */
  state?: SiteOrderState;
  read?: () => Promise<unknown>;
  write?: (value: BuyOrders) => Promise<void>;
  queueRead?: () => Promise<OrderQueue>;
  queueWrite?: (value: OrderQueue) => Promise<void>;
  /** Délai avant de retenter une entrée refusée. */
  retryMs?: number;
  /** Refus consécutifs avant d'arrêter la passe. */
  maxFailures?: number;
  /**
   * Médiane relue avant l'envoi, pour ne pas payer au-dessus du marché. Par défaut, la
   * médiane du marché (cache 5 min) : sans elle, le tri par marge ne saurait rien.
   */
  refreshMedian?: (characterId: number) => Promise<number | null>;
  /** Envoi injectable pour les tests ; `placeBuyOrder` par défaut. */
  place?: (
    api: Pick<ApiClient, 'request'>,
    draft: BuyOrderDraft,
    options: {
      plan?: BuyPlan;
      entries?: readonly BuyOrderEntry[];
      now?: number;
      write?: (value: BuyOrders) => Promise<void>;
    },
  ) => Promise<PlaceOrderResult>;
}

export interface ProcessQueueResult {
  placed: number;
  filled: number;
  total: number;
  /** Ordres encore en attente dans la file. */
  remaining: number;
  /** Places libres vues avant l'envoi. */
  freeBefore: number;
  limit: number;
  /** Raison de l'arrêt, `null` si toute la place disponible a été utilisée. */
  stop: string | null;
  /** Entrées refusées pendant la passe, gardées en file avec leur motif. */
  failures: QueueFailure[];
  /** Estimation lisible de la prochaine place libre. */
  nextFreeHint: string | null;
}

export interface QueueFailure {
  characterId: number;
  name: string | null;
  message: string;
}

export const ORDER_QUEUE_LOCK = 'kyara-plus:order-queue-process';

/** Chaîne locale : deux appels du même bundle ne se chevauchent jamais. */
let queueChain: Promise<unknown> = Promise.resolve();

/**
 * Un seul traitement de file à la fois, pour le bouton manuel comme pour la boucle auto.
 * La chaîne couvre le bundle courant ; le verrou Web Locks (même origine) couvre aussi le
 * panneau et le content script, qui embarquent chacun leur copie du module.
 */
export function withOrderQueueLock<T>(task: () => Promise<T>): Promise<T> {
  const run = async (): Promise<T> => {
    const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
    if (locks?.request) {
      return locks.request(ORDER_QUEUE_LOCK, { mode: 'exclusive' }, () => task());
    }
    return task();
  };
  const next = queueChain.then(run, run);
  queueChain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

/**
 * Envoie les premiers ordres de la file dans la limite des places libres du site.
 * Un refus laisse l'ordre en file pour la prochaine passe ; les réussites sont retirées
 * de la file au fur et à mesure, donc rien n'est perdu ni envoyé deux fois.
 */
export function processOrderQueue(
  api: Pick<ApiClient, 'request'>,
  options: ProcessQueueOptions = {},
): Promise<ProcessQueueResult> {
  return withOrderQueueLock(() => processQueueUnlocked(api, options));
}

async function processQueueUnlocked(
  api: Pick<ApiClient, 'request'>,
  options: ProcessQueueOptions,
): Promise<ProcessQueueResult> {
  const now = options.now ?? Date.now();
  const wait = options.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const gap = Math.max(0, options.gapMs ?? 1_500);
  const read = options.read ?? (() => buyOrdersItem.getValue());
  const write = options.write ?? ((value: BuyOrders) => buyOrdersItem.setValue(value));
  const queueRead = options.queueRead ?? (() => orderQueueItem.getValue());
  const queueWrite = options.queueWrite ?? ((value: OrderQueue) => orderQueueItem.setValue(value));
  const place = options.place ?? placeBuyOrder;
  const plan =
    options.plan ?? normalizeBuyPlan(await buyPlanItem.getValue().catch(() => null));
  let queue = normalizeOrderQueue(await queueRead().catch(() => null));
  let entries = [
    ...(options.entries ??
      normalizeBuyOrders(await read().catch(() => null)).entries),
  ];

  let state: SiteOrderState;
  try {
    state = options.state ?? (await readSiteOrderState(api));
  } catch (error) {
    return {
      placed: 0,
      filled: 0,
      total: 0,
      remaining: queue.entries.length,
      freeBefore: 0,
      limit: SITE_ORDER_LIMIT_FALLBACK,
      stop: error instanceof Error ? error.message : 'Lecture des ordres ouverts impossible.',
      failures: [],
      nextFreeHint: null,
    };
  }

  const slots = Math.max(0, state.limit - state.open);
  if (!queue.entries.length) {
    return {
      placed: 0,
      filled: 0,
      total: 0,
      remaining: 0,
      freeBefore: slots,
      limit: state.limit,
      stop: null,
      failures: [],
      nextFreeHint: null,
    };
  }
  if (slots <= 0) {
    return {
      placed: 0,
      filled: 0,
      total: 0,
      remaining: queue.entries.length,
      freeBefore: 0,
      limit: state.limit,
      stop: `Limite de ${state.limit} ordres ouverts atteinte : la file reprendra dès qu'une place se libère.`,
      failures: [],
      nextFreeHint: `dès qu'un ordre se ferme (${state.open} / ${state.limit} ouverts)`,
    };
  }

  // Les marges doivent être connues avant de choisir l'ordre de passage : les entrées
  // sans médiane (file ancienne, ajout hors panneau) sont chiffrées une fois ici.
  const refreshMedian =
    options.refreshMedian ?? ((characterId: number) => marketMedian(api, characterId));
  let enriched = false;
  for (const entry of [...queue.entries]) {
    if (entry.median !== null) continue;
    const median = await refreshMedian(entry.characterId).catch((): number | null => null);
    if (median === null || median <= 0) continue;
    queue = markQueueEntry(queue, entry.characterId, { median });
    enriched = true;
  }
  if (enriched) await queueWrite(queue);

  let placed = 0;
  let filled = 0;
  let total = 0;
  let stop: string | null = null;
  let consecutive = 0;
  let sent = 0;
  const failures: QueueFailure[] = [];
  const retryMs = Math.max(60_000, Math.trunc(options.retryMs ?? ORDER_QUEUE_ENTRY_RETRY_MS));
  const maxFailures = Math.max(1, Math.trunc(options.maxFailures ?? ORDER_QUEUE_MAX_FAILURES));
  // Passage par défaut : les meilleures marges d'abord (médiane − prix). Les flèches de
  // la ligne et « Trier par marge » ne changent que l'ordre affiché de la file ; sans
  // médiane connue, l'ordre manuel est conservé.
  for (const entry of sortQueueByMargin(queue).entries) {
    if (placed >= slots) {
      stop = `Places du site utilisées (${state.open + placed} / ${state.limit}) : la file reprendra dès qu'une place se libère.`;
      break;
    }
    // Une entrée refusée récemment attend son tour, sans bloquer les suivantes.
    if (entry.retryAt > now) continue;
    if (sent > 0) await wait(gap);
    sent += 1;
    // Dérive de prix : la médiane a baissé, l'ordre préparé payerait trop cher.
    {
      const median = await refreshMedian(entry.characterId).catch((): number | null => null);
      if (median !== null && median > 0) {
        if (queuePriceDrift(entry, median)) {
          const message = `Médiane descendue à ${median} ◆ : prix ${entry.price} ◆ à vérifier.`;
          queue = markQueueEntry(queue, entry.characterId, {
            median,
            error: message,
            retryAt: now + retryMs,
          });
          await queueWrite(queue);
          failures.push({ characterId: entry.characterId, name: entry.name, message });
          continue;
        }
        queue = markQueueEntry(queue, entry.characterId, { median });
        await queueWrite(queue);
      }
    }
    const draft: BuyOrderDraft = {
      characterId: entry.characterId,
      name: entry.name,
      price: entry.price,
      qty: entry.qty,
    };
    const result = await place(api, draft, { plan, entries, now, write });
    entries = [...(result.entries ?? entries)];
    if (!result.ok) {
      failures.push({ characterId: entry.characterId, name: entry.name, message: result.message });
      consecutive += 1;
      // L'entrée reste en file avec son motif : les suivantes ne sont plus bloquées.
      queue = markQueueEntry(queue, entry.characterId, {
        error: result.message,
        retryAt: now + retryMs,
      });
      await queueWrite(queue);
      if (consecutive >= maxFailures) {
        stop = result.message;
        break;
      }
      continue;
    }
    consecutive = 0;
    queue = removeQueuedOrders(queue, [entry.characterId]);
    await queueWrite(queue);
    placed += 1;
    filled += result.filled;
    total += entry.price * entry.qty;
  }

  const remaining = queue.entries.length;
  return {
    placed,
    filled,
    total,
    remaining,
    freeBefore: slots,
    limit: state.limit,
    stop,
    failures,
    nextFreeHint:
      remaining > 0
        ? `dès qu'un ordre se ferme (${state.open + placed} / ${state.limit} ouverts)`
        : null,
  };
}

export const ORDER_QUEUE_CHECK_MS = 2 * 60_000;
const ORDER_QUEUE_RETRY_MS = 5 * 60_000;
const ORDER_QUEUE_IDLE_MS = 60_000;

export interface OrderQueueRunnerDeps {
  api: Pick<ApiClient, 'request'>;
  getSettings: () => Promise<Settings>;
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  now: () => number;
  log: (message: string) => void;
  /** Échec technique d'une passe : le coupe-circuit compte les échecs consécutifs. */
  onFailure?: (reason: string) => void | Promise<void>;
  /** Passe terminée sans erreur : la série d'échecs est terminée. */
  onSuccess?: () => void | Promise<void>;
  /** Par défaut, la boucle attend un onglet visible. */
  isVisible?: () => boolean;
}

/**
 * Boucle de la file : tant que le réglage est actif, elle retente régulièrement de placer
 * les ordres en attente. Un refus du site (limite, chakra, vérification) allonge l'attente
 * sans retirer l'ordre de la file.
 */
export async function runOrderQueue(
  deps: OrderQueueRunnerDeps,
  signal: AbortSignal,
): Promise<StopReason> {
  const visible = deps.isVisible ?? (() => document.visibilityState === 'visible');
  deps.log('file d’ordres : boucle démarrée');
  while (!signal.aborted) {
    const settings = await deps.getSettings();
    if (!settings.orderQueueAuto || settings.killSwitch) {
      deps.log(settings.killSwitch ? 'file d’ordres : coupe-circuit actif' : 'file d’ordres : désactivée');
      return 'disabled';
    }
    if (!visible()) {
      await deps.sleep(ORDER_QUEUE_IDLE_MS, signal);
      continue;
    }
    const queue = normalizeOrderQueue(await orderQueueItem.getValue().catch(() => null));
    if (!queue.entries.length) {
      await deps.sleep(ORDER_QUEUE_IDLE_MS, signal);
      continue;
    }
    let pause = ORDER_QUEUE_CHECK_MS;
    try {
      const result = await processOrderQueue(deps.api, {
        plan: normalizeBuyPlan(await buyPlanItem.getValue().catch(() => null)),
        now: deps.now(),
      });
      if (result.placed) {
        deps.log(
          `file d’ordres : ${result.placed} placé(s) · ${result.total} ◆ · ${result.remaining} en attente`,
        );
      }
      if (result.stop) {
        deps.log(`file d’ordres : ${result.stop}`);
        pause = ORDER_QUEUE_RETRY_MS;
      }
      for (const failure of result.failures.slice(0, 3)) {
        deps.log(
          `file d’ordres : ${failure.name ?? `Carte #${failure.characterId}`} gardée en file — ${failure.message}`,
        );
      }
      // Un arrêt après plusieurs refus de suite est un échec ; la limite de places, non.
      if (result.stop && result.failures.length) await deps.onFailure?.(result.stop);
      else await deps.onSuccess?.();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'erreur inconnue';
      deps.log(`file d’ordres : ${message}`);
      if (isCircuitFailure(error)) await deps.onFailure?.(message);
      pause = ORDER_QUEUE_RETRY_MS;
    }
    await deps.sleep(pause, signal);
  }
  return 'aborted';
}
