import { AuthError, PassRequiredError, type ApiClient } from '../api';

/**
 * Achats du marché : prix fixe et enchères. Les deux passent par les routes du site,
 * une requête par annonce, avec une pause et un arrêt sur refus répétés. Aucun achat
 * n'est envoyé sans un appel explicite de ces fonctions.
 */

export type Api = Pick<ApiClient, 'request'>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const positive = (value: unknown): number | null => {
  const number = typeof value === 'string' ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number) && number > 0 ? number : null;
};

export interface MarketBuyLine {
  id: string;
  name?: string | null;
  price: number;
  /** Carte concernée, pour tenir le journal des dépenses. */
  characterId?: number;
}

export interface MarketBuyOutcome {
  ok: boolean;
  message: string;
  /** Prix réellement payé (prix final de l'annonce) quand il est connu. */
  paid: number | null;
}

/** Durée de validité d'un meilleur ordre lu, pour ne pas pricer sur une valeur périmée. */
export const BEST_BID_TTL_MS = 5 * 60_000;

const bestBidCache = new Map<number, { at: number; value: number }>();

/** Vide le cache des meilleurs ordres (après une annulation ou un placement). */
export function clearBestBidCache(): void {
  bestBidCache.clear();
}

/** Meilleur ordre d'achat ouvert sur une carte, 0 s'il n'y en a pas. */
export async function bestBuyBid(
  api: Api,
  characterId: number,
  fresh = false,
  now = Date.now(),
): Promise<number> {
  const hit = bestBidCache.get(characterId);
  if (!fresh && hit && now - hit.at < BEST_BID_TTL_MS) return hit.value;
  try {
    const data = await api.request<unknown>(
      `/api/market/buy-orders?characterId=${encodeURIComponent(String(characterId))}`,
    );
    const items = Array.isArray(data)
      ? data
      : isRecord(data) && Array.isArray(data.items)
        ? data.items
        : [];
    let best = 0;
    for (const item of items) {
      if (!isRecord(item)) continue;
      const price = positive(item.price) ?? 0;
      if (price > best) best = price;
    }
    bestBidCache.set(characterId, { at: now, value: best });
    return best;
  } catch {
    return hit?.value ?? 0;
  }
}

export interface MarketBidOutcome {
  ok: boolean;
  message: string;
  /** Faux quand une autre mise a suivi immédiatement la nôtre. */
  leading: boolean;
  currentBid: number | null;
}

/** Achète tout de suite une annonce à prix fixe (ou une enchère avec achat immédiat). */
export async function buyListing(api: Api, id: string): Promise<MarketBuyOutcome> {
  try {
    const data = await api.request<unknown>(
      `/api/market/listings/${encodeURIComponent(id)}/buy`,
      { method: 'POST' },
    );
    const record = isRecord(data) ? data : {};
    const listing = isRecord(record.listing) ? record.listing : {};
    const paid = positive(listing.finalPrice) ?? positive(listing.price);
    return {
      ok: true,
      message: paid === null ? 'Achat effectué.' : `Achat effectué pour ${paid} ◆.`,
      paid,
    };
  } catch (error) {
    if (error instanceof AuthError || error instanceof PassRequiredError) throw error;
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
      paid: null,
    };
  }
}

/** Place une mise (ou une enchère automatique jusqu'au maximum demandé). */
export async function bidListing(
  api: Api,
  id: string,
  maxAmount: number,
): Promise<MarketBidOutcome> {
  const amount = Math.max(1, Math.round(maxAmount));
  try {
    const data = await api.request<unknown>(
      `/api/market/listings/${encodeURIComponent(id)}/bid`,
      { method: 'POST', body: { maxAmount: amount } },
    );
    const record = isRecord(data) ? data : {};
    const listing = isRecord(record.listing) ? record.listing : {};
    const leading = record.leading === true || listing.leading === true;
    const currentBid = positive(listing.currentBid);
    return {
      ok: true,
      message: leading
        ? `Mise de ${amount} ◆ : tu es en tête.`
        : `Mise de ${amount} ◆ enregistrée${currentBid ? `, surenchéri à ${currentBid} ◆` : ''}.`,
      leading,
      currentBid,
    };
  } catch (error) {
    if (error instanceof AuthError || error instanceof PassRequiredError) throw error;
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
      leading: false,
      currentBid: null,
    };
  }
}

/** Fenêtre avant la fin pendant laquelle une mise « de la dernière minute » part. */
export const SNIPE_LEAD_MS = 60_000;

/** Délai à attendre avant de miser à la fin ; `null` sans échéance lisible. */
export function snipeDelay(
  endsAt: string | null,
  now = Date.now(),
  leadMs = SNIPE_LEAD_MS,
): number | null {
  if (!endsAt) return null;
  const at = Date.parse(endsAt);
  if (!Number.isFinite(at)) return null;
  return Math.max(0, at - now - Math.max(0, leadMs));
}

export interface SnipeOptions {
  /** Fin annoncée de l'enchère (ISO), telle que lue dans la recherche. */
  endsAt: string | null;
  /** Plafond de la mise, borne haute de l'enchère automatique. */
  maxAmount: number;
  now?: () => number;
  wait?: (ms: number, signal: AbortSignal) => Promise<void>;
  signal?: AbortSignal;
  leadMs?: number;
}

export interface SnipeOutcome {
  /** `null` quand la mise a été annulée avant son départ. */
  bid: MarketBidOutcome | null;
  /** Vrai quand l'attente a été interrompue. */
  cancelled: boolean;
}

/**
 * Mise de fin d'enchère : attend la dernière minute, puis mise au plafond demandé. Rien
 * n'est envoyé si l'échéance manque ou est déjà passée, et une annulation pendant
 * l'attente empêche la mise.
 */
export async function snipeBid(
  api: Api,
  id: string,
  options: SnipeOptions,
): Promise<SnipeOutcome> {
  const now = options.now ?? Date.now;
  const delay = snipeDelay(options.endsAt, now(), options.leadMs);
  if (delay === null) {
    return {
      bid: {
        ok: false,
        message: 'Échéance inconnue : mise à la fin impossible.',
        leading: false,
        currentBid: null,
      },
      cancelled: false,
    };
  }
  const at = options.endsAt ? Date.parse(options.endsAt) : 0;
  if (Number.isFinite(at) && at <= now()) {
    return {
      bid: { ok: false, message: 'Enchère déjà terminée.', leading: false, currentBid: null },
      cancelled: false,
    };
  }
  const signal = options.signal;
  const wait =
    options.wait ??
    ((ms: number, abort: AbortSignal) =>
      new Promise<void>((resolve) => {
        if (abort.aborted) return resolve();
        const timer = setTimeout(resolve, ms);
        abort.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
      }));
  if (delay > 0) {
    if (!signal) {
      await new Promise<void>((resolve) => setTimeout(resolve, delay));
    } else {
      await wait(delay, signal);
    }
  }
  if (signal?.aborted) return { bid: null, cancelled: true };
  return { bid: await bidListing(api, id, options.maxAmount), cancelled: false };
}

export interface BatchBuyOptions {
  /** Pause entre deux achats, 1 200 ms par défaut. */
  gapMs?: number;
  wait?: (ms: number) => Promise<void>;
  onProgress?: (done: number, total: number, spent: number) => void;
  /** Appelée après chaque achat réussi, pour tenir le journal des dépenses. */
  onBuy?: (line: MarketBuyLine, outcome: MarketBuyOutcome) => void | Promise<void>;
  /** Même journal pour une enchère emportée (mise en tête après la mise). */
  onBid?: (line: BidLine, outcome: MarketBidOutcome) => void | Promise<void>;
  /** Refus local avant une mise (plafond du jour) ; la ligne est sautée, pas la série. */
  checkBid?: (line: BidLine) => Promise<string | null>;
}

export interface BatchBuyResult {
  bought: number;
  spent: number;
  failures: number;
  /** Premier refus qui a arrêté la série, `null` si tout est passé. */
  stop: string | null;
}

const defaultWait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const shouldStop = (message: string, status?: number): boolean =>
  status === 401 || status === 429 || /session|auth|trop de requêtes|rate/i.test(message);

/** Achète une liste d'annonces l'une après l'autre, en s'arrêtant sur refus répétés. */
export async function buyListings(
  api: Api,
  lines: readonly MarketBuyLine[],
  options: BatchBuyOptions = {},
): Promise<BatchBuyResult> {
  const wait = options.wait ?? defaultWait;
  const gap = Math.max(0, options.gapMs ?? 1_200);
  let bought = 0;
  let spent = 0;
  let failures = 0;
  let stop: string | null = null;
  for (const [index, line] of lines.entries()) {
    if (index > 0) await wait(gap);
    const outcome = await buyListing(api, line.id);
    if (!outcome.ok) {
      failures += 1;
      stop = outcome.message;
      if (failures >= 3 || shouldStop(outcome.message)) break;
      continue;
    }
    bought += 1;
    failures = 0;
    spent += outcome.paid ?? line.price;
    await options.onBuy?.(line, outcome);
    options.onProgress?.(index + 1, lines.length, spent);
  }
  return { bought, spent, failures, stop: bought === lines.length ? null : stop };
}

export interface BidLine {
  id: string;
  name?: string | null;
  maxAmount: number;
  /** Carte concernée, pour le plafond du jour et le journal des dépenses. */
  characterId?: number;
}

/** Mise une liste d'enchères l'une après l'autre, avec la même prudence. */
export async function bidListings(
  api: Api,
  lines: readonly BidLine[],
  options: BatchBuyOptions = {},
): Promise<BatchBuyResult> {
  const wait = options.wait ?? defaultWait;
  const gap = Math.max(0, options.gapMs ?? 1_500);
  let bought = 0;
  let spent = 0;
  let failures = 0;
  let stop: string | null = null;
  for (const [index, line] of lines.entries()) {
    if (index > 0) await wait(gap);
    // Plafond du jour vérifié avant chaque mise : une enchère trop chère est sautée,
    // les suivantes restent possibles.
    const refusal = options.checkBid ? await options.checkBid(line) : null;
    if (refusal) {
      failures += 1;
      stop = refusal;
      if (failures >= 3) break;
      continue;
    }
    const outcome = await bidListing(api, line.id, line.maxAmount);
    if (!outcome.ok) {
      failures += 1;
      stop = outcome.message;
      if (failures >= 3 || shouldStop(outcome.message)) break;
      continue;
    }
    bought += 1;
    failures = 0;
    spent += line.maxAmount;
    // Seule une mise en tête est une enchère emportée pour l'instant : elle entre au
    // journal des dépenses, au montant réellement engagé quand il est connu.
    if (outcome.leading) await options.onBid?.(line, outcome);
    options.onProgress?.(index + 1, lines.length, spent);
  }
  return { bought, spent, failures, stop: bought === lines.length ? null : stop };
}
