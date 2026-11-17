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
}

export interface MarketBuyOutcome {
  ok: boolean;
  message: string;
  /** Prix réellement payé (prix final de l'annonce) quand il est connu. */
  paid: number | null;
}

const bestBidCache = new Map<number, number>();

/** Meilleur ordre d'achat ouvert sur une carte, 0 s'il n'y en a pas. */
export async function bestBuyBid(api: Api, characterId: number, fresh = false): Promise<number> {
  if (!fresh && bestBidCache.has(characterId)) return bestBidCache.get(characterId) ?? 0;
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
    bestBidCache.set(characterId, best);
    return best;
  } catch {
    return bestBidCache.get(characterId) ?? 0;
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

export interface BatchBuyOptions {
  /** Pause entre deux achats, 1 200 ms par défaut. */
  gapMs?: number;
  wait?: (ms: number) => Promise<void>;
  onProgress?: (done: number, total: number, spent: number) => void;
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
    options.onProgress?.(index + 1, lines.length, spent);
  }
  return { bought, spent, failures, stop: bought === lines.length ? null : stop };
}

export interface BidLine {
  id: string;
  name?: string | null;
  maxAmount: number;
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
    options.onProgress?.(index + 1, lines.length, spent);
  }
  return { bought, spent, failures, stop: bought === lines.length ? null : stop };
}
