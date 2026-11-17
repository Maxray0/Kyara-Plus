import type { CatalogCard } from '../stats/model';
import { call, fetchFairPrices, record, type Api } from './market';
import { invalidateOwnedCache } from './owned-cache';
import type { TradeSettings } from './trade-settings';

/**
 * Offre du comptoir : quelqu'un propose `characterId` contre l'une des cartes de `wantIds`.
 * Le statut absent est traité comme « ouverte », comme dans le legacy.
 */
export interface TradeOffer {
  id: string;
  userId: string | null;
  userPseudo: string | null;
  takerId: string | null;
  characterId: number;
  wantIds: number[];
  status: string;
  createdAt: string | null;
  expiresAt: string | null;
}

export interface OwnedCards {
  owned: Map<number, number>;
  blocked: Set<number>;
}

export interface TradeDeal {
  offerId: string;
  /** Carte proposée par l'autre joueur. */
  leftId: number;
  /** Carte à donner, choisie parmi les demandées. */
  giveId: number;
  /** Exemplaires possédés de la carte à donner. */
  n: number;
  /** Rareté reçue strictement supérieure. */
  up: boolean;
  gain: number;
  give: number;
  get: number;
  rarity: string;
  at: string | null;
  expiresAt: string | null;
}

const RARITY_RANK: Record<string, number> = { C: 1, U: 2, R: 3, E: 4, L: 5, M: 6 };

function offersList(data: unknown): unknown[] | null {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    const items = (data as Record<string, unknown>).items;
    if (Array.isArray(items)) return items;
  }
  return null;
}

export function isOffersPayload(data: unknown): boolean {
  return offersList(data) !== null;
}

export function normalizeOffers(data: unknown): TradeOffer[] {
  const list = offersList(data) ?? [];
  const offers: TradeOffer[] = [];
  for (const raw of list) {
    const source = record(raw);
    const id = source.id;
    const characterId = Number(source.characterId);
    if (
      id === undefined ||
      id === null ||
      id === '' ||
      !Number.isSafeInteger(characterId) ||
      characterId < 1
    )
      continue;
    if (!Array.isArray(source.wantIds)) continue;
    const wantIds = [
      ...new Set(
        source.wantIds.map(Number).filter((value) => Number.isSafeInteger(value) && value > 0),
      ),
    ];
    const user = record(source.user);
    const taker = record(source.taker);
    offers.push({
      id: String(id),
      userId: user.id === undefined || user.id === null ? null : String(user.id),
      userPseudo: typeof user.pseudo === 'string' ? user.pseudo : null,
      takerId: taker.id === undefined || taker.id === null ? null : String(taker.id),
      characterId,
      wantIds,
      status: typeof source.status === 'string' ? source.status : '',
      createdAt: typeof source.createdAt === 'string' ? source.createdAt : null,
      expiresAt: typeof source.expiresAt === 'string' ? source.expiresAt : null,
    });
  }
  return offers;
}

/** Mon identifiant : celui présent dans toutes mes offres, en créateur ou en preneur. */
export function myIdFromOffers(data: unknown): string | null {
  const lists = normalizeOffers(data).map((offer) =>
    [offer.userId, offer.takerId].filter((id): id is string => Boolean(id)),
  );
  if (!lists.length) return null;
  return lists[0]?.find((id) => lists.every((list) => list.includes(id))) ?? null;
}

/** Quantités possédées et cartes non échangeables, lues dans `/api/me/collection?lean=1`. */
export function ownedFromCollection(data: unknown): OwnedCards {
  const rows = Array.isArray(data)
    ? data
    : (Object.values(record(data)).find((value): value is unknown[] => Array.isArray(value)) ?? []);
  const owned = new Map<number, number>();
  const blocked = new Set<number>();
  for (const raw of rows) {
    const row = record(raw);
    const id = Number(row.characterId);
    if (!Number.isSafeInteger(id) || id < 1) continue;
    owned.set(id, Math.max(0, Math.floor(Number(row.qty) || 0)));
    if (
      row.locked === true ||
      row.pinned === true ||
      row.isPinned === true ||
      row.resaleLocked === true ||
      row.tradeLocked === true ||
      row.canTrade === false ||
      row.tradable === false ||
      (row.tradeBlock !== undefined &&
        row.tradeBlock !== null &&
        row.tradeBlock !== false &&
        row.tradeBlock !== '')
    ) {
      blocked.add(id);
    }
  }
  return { owned, blocked };
}

export async function fetchOwned(api: Api): Promise<OwnedCards> {
  const result = await call(api, '/api/me/collection?lean=1');
  if (!result.ok) throw new Error(`Collection : ${result.message}`);
  return ownedFromCollection(result.data);
}

/**
 * Accepte une offre en donnant exactement la carte choisie (`withId`). Le site reste
 * l'autorité : il peut refuser si l'offre a changé, expiré ou si la carte n'est plus là.
 */
export async function acceptTrade(api: Api, offerId: string, withId: number): Promise<void> {
  if (!offerId.trim()) throw new Error('Offre invalide');
  if (!Number.isSafeInteger(withId) || withId < 1) throw new Error('Carte invalide');
  await api.request(`/api/trades/offers/${encodeURIComponent(offerId)}/accept`, {
    method: 'POST',
    body: { withId },
  });
  // La carte reçue entre dans la collection et la carte donnée en sort : on périme la
  // possession mémorisée ici pour couvrir le panneau comme la page Échanges.
  await invalidateOwnedCache('échange');
}

/**
 * Cartes dont le prix habituel est utile : la carte proposée (si je ne l'ai pas) et mes
 * exemplaires des cartes demandées qui passent le minimum de copies.
 */
export function offersNeedingPrices(
  offers: readonly TradeOffer[],
  cards: OwnedCards,
  settings: TradeSettings,
  myId: string | null,
  now = Date.now(),
): number[] {
  const need = new Set<number>();
  const minQty = settings.tradeUseLast ? 1 : 2;
  for (const offer of offers) {
    if (offer.status && offer.status !== 'open') continue;
    if (myId && offer.userId === myId) continue;
    if (offer.expiresAt) {
      const expires = Date.parse(offer.expiresAt);
      if (Number.isFinite(expires) && expires < now) continue;
    }
    if ((cards.owned.get(offer.characterId) ?? 0) > 0) continue;
    const candidates = offer.wantIds.filter(
      (id) => (cards.owned.get(id) ?? 0) >= minQty && !cards.blocked.has(id),
    );
    if (!candidates.length) continue;
    need.add(offer.characterId);
    for (const id of candidates) need.add(id);
  }
  return [...need];
}

export interface TradeContext {
  owned: ReadonlyMap<number, number>;
  blocked: ReadonlySet<number>;
  fair: ReadonlyMap<number, number>;
  rarity: (id: number) => string;
  settings: TradeSettings;
  myId?: string | null;
  now?: number;
}

/**
 * Port de `tradeDeals` : pour chaque offre ouverte dont je n'ai pas la carte, choisit la
 * meilleure carte à donner. Un doublon passe avant une dernière copie ; à copie égale, la
 * rareté supérieure puis le plus gros gain l'emportent.
 */
export function evaluateTrades(offers: readonly TradeOffer[], context: TradeContext): TradeDeal[] {
  const now = context.now ?? Date.now();
  const tolerance = Math.max(0, context.settings.tradeTol) / 100;
  const checkRarity = context.settings.tradeSameRarity;
  const useLast = context.settings.tradeUseLast;
  const lastGain = Math.max(0, context.settings.tradeLastGain) / 100;
  const out: TradeDeal[] = [];

  for (const offer of offers) {
    if (offer.status && offer.status !== 'open') continue;
    if (context.myId && offer.userId === context.myId) continue;
    if (offer.expiresAt) {
      const expires = Date.parse(offer.expiresAt);
      if (Number.isFinite(expires) && expires < now) continue;
    }
    const leftId = offer.characterId;
    if ((context.owned.get(leftId) ?? 0) > 0) continue;
    const leftPrice = context.fair.get(leftId) ?? 0;
    const leftRarity = context.rarity(leftId);
    if (!(leftPrice > 0)) continue;

    let best: {
      giveId: number;
      n: number;
      up: boolean;
      gain: number;
      give: number;
      get: number;
    } | null = null;

    for (const id of offer.wantIds) {
      const n = context.owned.get(id) ?? 0;
      if (n < 1 || (n < 2 && !useLast) || context.blocked.has(id)) continue;
      const rarity = context.rarity(id);
      const price = context.fair.get(id) ?? 0;
      const last = n === 1;
      if (
        (checkRarity || last) &&
        leftRarity &&
        rarity &&
        (RARITY_RANK[leftRarity] ?? 0) < (RARITY_RANK[rarity] ?? 0)
      ) {
        continue;
      }
      if (!(price > 0) || leftPrice < price * (last ? 1 + lastGain : 1 - tolerance)) continue;
      const up =
        Boolean(leftRarity && rarity) &&
        (RARITY_RANK[leftRarity] ?? 0) > (RARITY_RANK[rarity] ?? 0);
      const gain = leftPrice - price;
      if (
        !best ||
        (best.n === 1 && !last) ||
        (last === (best.n === 1) && (up === best.up ? gain > best.gain : up && !best.up))
      ) {
        best = { giveId: id, n, up, gain, give: price, get: leftPrice };
      }
    }

    if (best) {
      out.push({
        offerId: offer.id,
        leftId,
        giveId: best.giveId,
        n: best.n,
        up: best.up,
        gain: Math.round(best.gain),
        give: best.give,
        get: best.get,
        rarity: leftRarity,
        at: offer.createdAt,
        expiresAt: offer.expiresAt,
      });
    }
  }

  return out.sort((a, b) => {
    const left = a.at ? Date.parse(a.at) : 0;
    const right = b.at ? Date.parse(b.at) : 0;
    return (Number.isFinite(right) ? right : 0) - (Number.isFinite(left) ? left : 0);
  });
}

export interface TradeBoard {
  offers: TradeOffer[];
  deals: TradeDeal[];
  cards: OwnedCards;
  myId: string | null;
  fair: Map<number, number>;
}

/** Raison d'une offre qui ne passe pas les réglages, commune au panneau et à la page. */
export function noDealReason(board: TradeBoard, offer: TradeOffer, now = Date.now()): string {
  if (offer.status && offer.status !== 'open') return 'Offre fermée';
  if (board.myId && offer.userId === board.myId) return 'Ton offre';
  if ((board.cards.owned.get(offer.characterId) ?? 0) > 0) return 'Tu as déjà cette carte';
  if (offer.expiresAt) {
    const expires = Date.parse(offer.expiresAt);
    if (Number.isFinite(expires) && expires < now) return 'Offre expirée';
  }
  const wanted = offer.wantIds.some(
    (id) => (board.cards.owned.get(id) ?? 0) > 0 && !board.cards.blocked.has(id),
  );
  if (!wanted) return 'Aucune carte demandée en ta possession';
  if (!(board.fair.get(offer.characterId) ?? 0)) return 'Prix de la carte proposée indisponible';
  return 'Pas rentable avec tes réglages';
}

/** Lecture complète du comptoir : offres, identité, collection, prix habituels, évaluation. */
export async function loadTradeBoard(
  api: Api,
  settings: TradeSettings,
  catalog: readonly CatalogCard[],
  now = Date.now(),
): Promise<TradeBoard> {
  const offersResult = await call(api, '/api/trades/offers');
  if (!offersResult.ok) throw new Error(`Échanges : ${offersResult.message}`);
  if (!isOffersPayload(offersResult.data)) throw new Error('Format des échanges inattendu');
  const offers = normalizeOffers(offersResult.data);

  const mine = await call(api, '/api/trades/offers/mine');
  const myId = mine.ok ? myIdFromOffers(mine.data) : null;
  const cards = await fetchOwned(api);
  const need = offersNeedingPrices(offers, cards, settings, myId, now);
  const fair = need.length ? await fetchFairPrices(api, need) : new Map<number, number>();

  const rarityById = new Map<number, string>();
  for (const card of catalog) {
    const id = Number(card.id);
    if (Number.isSafeInteger(id)) {
      const rarity = String(card.rarity).toUpperCase();
      rarityById.set(id, rarity === 'S' ? 'L' : rarity);
    }
  }

  const deals = evaluateTrades(offers, {
    owned: cards.owned,
    blocked: cards.blocked,
    fair,
    rarity: (id) => rarityById.get(id) ?? '',
    settings,
    myId,
    now,
  });

  return { offers, deals, cards, myId, fair };
}
