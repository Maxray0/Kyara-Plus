import type { Api } from './market';
import { call } from './market';
import { normalizeListings } from './market-search';

/**
 * Conseiller de doublons (lecture seule) : pour chaque carte possédée en plusieurs
 * exemplaires, croise les prix du site, la concurrence, les ordres d'achat et la
 * valeur de recyclage, puis conseille **Vendre**, **Vendre à l'ordre** ou **Recycler**.
 *
 * Repris des règles du site relevées en octobre 2026 — frais de mise en vente
 * max(1, 2 %), taxe de vente 5 %, prix plancher 15 ◆ dès Épique. Aucune écriture :
 * ce module ne pose ni annonce ni ordre.
 */

export interface MarketRules {
  listingFeePct: number;
  listingFeeMin: number;
  saleTaxPct: number;
}

/** Barème de repli, remplacé par `/api/config` quand il le donne. */
export const MARKET_RULES: MarketRules = { listingFeePct: 2, listingFeeMin: 1, saleTaxPct: 5 };

/** Valeurs de recyclage par défaut, remplacées par `/api/config` quand il les donne. */
export const DEFAULT_RECYCLE: Readonly<Record<string, number>> = {
  C: 1,
  U: 1,
  R: 3,
  E: 10,
  L: 40,
  M: 150,
};

/** Prix minimum qu'un ordre ou une annonce peut demander (15 ◆ dès Épique). */
const MIN_PRICE: Readonly<Record<string, number>> = { E: 15, L: 15, M: 15 };

/** Durées d'annonce : 12 / 24 / 48 h (3 j et 7 j avec les rangs Sensei et Daimyō). */
export const DEFAULT_DURATIONS: readonly number[] = [12, 24, 48];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

function amount(value: unknown): number | null {
  const number = typeof value === 'string' ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number) && number >= 0 ? number : null;
}

function count(value: unknown): number {
  const number = amount(value);
  return number === null ? 0 : Math.trunc(number);
}

export function listingFee(price: number, rules: MarketRules = MARKET_RULES): number {
  return Math.max(rules.listingFeeMin, Math.ceil((price * rules.listingFeePct) / 100));
}

export function saleTax(price: number, rules: MarketRules = MARKET_RULES): number {
  return Math.ceil((price * rules.saleTaxPct) / 100);
}

/** Ce que tu touches réellement si l'annonce part à ce prix. */
export function netFromSale(price: number, rules: MarketRules = MARKET_RULES): number {
  return price - saleTax(price, rules) - listingFee(price, rules);
}

export function minPrice(rarity: string): number {
  return MIN_PRICE[rarity] ?? 1;
}

/** Barème de frais lu dans `/api/config` (plat ou sous `market`), avec repli. */
export function marketRules(data: unknown): MarketRules {
  const root = isRecord(data) ? (isRecord(data.market) ? data.market : data) : {};
  const pct = (value: unknown, fallback: number): number => {
    const number = amount(value);
    return number === null ? fallback : Math.min(100, number);
  };
  return {
    listingFeePct: pct(root.listingFeePct, MARKET_RULES.listingFeePct),
    listingFeeMin: pct(root.listingFeeMin, MARKET_RULES.listingFeeMin),
    saleTaxPct: pct(root.saleTaxPct, MARKET_RULES.saleTaxPct),
  };
}

/** Table de recyclage lue dans `/api/config`, avec repli sur les valeurs connues. */
export function recycleTable(data: unknown): Record<string, number> {
  const table: Record<string, number> = { ...DEFAULT_RECYCLE };
  const raw = isRecord(data) && isRecord(data.recycle) ? data.recycle : null;
  if (!raw) return table;
  for (const [rarity, value] of Object.entries(raw)) {
    const price = amount(value);
    if (price !== null) table[rarity.toUpperCase()] = Math.trunc(price);
  }
  return table;
}

/** Probabilité qu'une carte avec `sales7d` ventes par semaine parte en `hours` heures. */
export function pSellIn(sales7d: number, hours: number): number {
  return 1 - Math.exp(-((sales7d || 0) * hours) / (24 * 7));
}

/** Durée la plus courte qui garde `target` de chances de vendre. */
export function pickDuration(
  sales7d: number,
  target = 0.95,
  durations: readonly number[] = DEFAULT_DURATIONS,
): number {
  const list = durations.length ? durations : DEFAULT_DURATIONS;
  return (
    list.find((hours) => pSellIn(sales7d, hours) >= target) ?? list[list.length - 1] ?? 48
  );
}

export interface PriceSnapshot {
  median7d: number | null;
  median30d: number | null;
  sales7d: number;
  sales30d: number;
}

/** Lit `/api/market/prices/{id}` sans rien inventer : un champ douteux devient 0 ou null. */
export function normalizePriceSnapshot(data: unknown): PriceSnapshot {
  const root = isRecord(data) ? data : {};
  return {
    median7d: amount(root.median7d),
    median30d: amount(root.median30d),
    sales7d: count(root.sales7d),
    sales30d: count(root.sales30d),
  };
}

/** Prix de référence : médiane 7 j si elle a au moins 2 ventes, sinon 30 j. */
export function referencePrice(
  prices: PriceSnapshot,
): { price: number; basis: '7j' | '30j'; sales: number } | null {
  if (prices.sales7d >= 2 && prices.median7d) {
    return { price: prices.median7d, basis: '7j', sales: prices.sales7d };
  }
  if (prices.sales30d >= 2 && prices.median30d) {
    return { price: prices.median30d, basis: '30j', sales: prices.sales30d };
  }
  return null;
}

export interface BuyOrder {
  id: string | null;
  price: number;
  qty: number;
  status: string;
}

const CLOSED_ORDER = new Set(['filled', 'cancelled', 'canceled', 'expired', 'closed']);

export function normalizeBuyOrders(data: unknown): BuyOrder[] {
  const items = Array.isArray(data)
    ? data
    : isRecord(data) && Array.isArray(data.items)
      ? data.items
      : isRecord(data) && Array.isArray(data.orders)
        ? data.orders
        : [];
  const orders: BuyOrder[] = [];
  for (const item of items) {
    if (!isRecord(item)) continue;
    const price = amount(item.price);
    if (price === null || price <= 0) continue;
    const status = typeof item.status === 'string' ? item.status.trim().toLowerCase() : 'active';
    if (CLOSED_ORDER.has(status)) continue;
    orders.push({
      id: typeof item.id === 'string' ? item.id : null,
      price,
      qty: Math.max(0, count(item.qty ?? item.quantity ?? item.remaining)),
      status,
    });
  }
  return orders;
}

/** Meilleur ordre d'achat : le prix le plus haut encore ouvert. */
export function bestBid(orders: readonly BuyOrder[]): number | null {
  let best: number | null = null;
  for (const order of orders) {
    if (order.qty === 0 && order.status !== 'active') continue;
    if (best === null || order.price > best) best = order.price;
  }
  return best;
}

export interface AdviceInput {
  rarity: string;
  prices: PriceSnapshot;
  /** Annonce à prix fixe la moins chère des autres vendeurs. */
  lowestAsk: number | null;
  /** Nombre d'annonces actives des autres vendeurs. */
  activeListings: number | null;
  bestBid: number | null;
  recycle: Readonly<Record<string, number>>;
  /** Barème lu dans `/api/config` ; repli sur `MARKET_RULES`. */
  rules?: MarketRules;
  durations?: readonly number[];
}

export interface SellAdvice {
  verdict: 'vendre' | 'ordre' | 'recycler';
  why: string;
  recycle: number;
  ref: number | null;
  sales7d: number;
  lowestAsk: number | null;
  activeListings: number | null;
  bestBid?: number;
  price?: number;
  net?: number;
  bidNet?: number;
  pSell?: number;
  duration?: number;
  pSellAtDuration?: number;
  ev?: number;
  gainVsRecycle?: number;
  outlier?: boolean;
}

/**
 * Conseil pour un doublon. L'ordre d'achat est une vente instantanée : si son net
 * dépasse le recyclage et l'espérance d'une annonce, il passe devant.
 */
export function adviseSell(input: AdviceInput): SellAdvice {
  const { rarity, prices, lowestAsk, activeListings } = input;
  const durations = input.durations?.length ? input.durations : DEFAULT_DURATIONS;
  const rules = input.rules ?? MARKET_RULES;
  const recycle = input.recycle[rarity] ?? 0;
  const ref = referencePrice(prices);
  const advice: SellAdvice = {
    verdict: 'recycler',
    why: '',
    recycle,
    ref: ref?.price ?? null,
    sales7d: prices.sales7d,
    lowestAsk,
    activeListings,
  };

  if (input.bestBid !== null && input.bestBid > 0) {
    advice.bestBid = input.bestBid;
    advice.bidNet = netFromSale(input.bestBid, rules);
  }

  if (!ref && !lowestAsk) {
    const bidNet = advice.bidNet ?? 0;
    if (bidNet > recycle) {
      advice.verdict = 'ordre';
      advice.why = `Ordre d'achat à ${advice.bestBid} ◆`;
      advice.ev = bidNet;
    } else {
      advice.verdict = 'recycler';
      advice.why = 'Aucune vente récente : invendable';
      advice.ev = recycle;
    }
    return advice;
  }

  // Ici `ref` ou `lowestAsk` existe : le cas « ni l'un ni l'autre » est sorti plus haut.
  const floor = minPrice(rarity);
  const reference = ref?.price ?? (lowestAsk as number);
  const floor70 = ref ? Math.round(ref.price * 0.7) : 0;
  const price =
    lowestAsk && lowestAsk <= reference
      ? Math.max(floor, Math.max(floor70, lowestAsk - 1))
      : Math.max(floor, reference);
  const outlier = !!(ref && lowestAsk && floor70 > floor && lowestAsk - 1 < floor70);
  const net = netFromSale(price, rules);
  const maxHours = durations[durations.length - 1] ?? 48;
  const pSell = pSellIn(prices.sales7d, maxHours);
  const duration = pickDuration(prices.sales7d, 0.95, durations);
  // Si ça ne part pas : frais perdus, mais la carte reste recyclable.
  const ev = pSell * net + (1 - pSell) * (recycle - listingFee(price, rules));
  const best = Math.max(ev, advice.bidNet ?? Number.NEGATIVE_INFINITY, recycle);

  advice.outlier = outlier;
  advice.price = price;
  advice.net = net;
  advice.pSell = pSell;
  advice.duration = duration;
  advice.pSellAtDuration = pSellIn(prices.sales7d, duration);
  advice.ev = ev;
  if (advice.bidNet !== undefined && best === advice.bidNet && advice.bidNet > recycle) {
    advice.verdict = 'ordre';
    advice.why = `Ordre d'achat à ${advice.bestBid} ◆ → ${advice.bidNet} ◆ net tout de suite`;
  } else if (ev > recycle + 1 && net > recycle) {
    advice.verdict = 'vendre';
    advice.why = outlier
      ? `Annonce à ${lowestAsk} ◆ anormalement basse ignorée (plancher 70 % de la médiane)`
      : `≈${Math.round(pSell * 100)} % de chances de vendre en ${
          maxHours >= 72 ? `${maxHours / 24} j` : `${maxHours} h`
        }`;
  } else {
    advice.verdict = 'recycler';
    advice.why =
      net <= recycle
        ? 'Le recyclage rapporte plus que la vente'
        : 'Trop peu de ventes pour valoir les frais';
  }
  advice.gainVsRecycle = Math.round((best - recycle) * 10) / 10;
  return advice;
}

/** Cache mémoire des lectures par carte : un onglet rouvert ne relit pas le site. */
export const ADVISOR_CACHE_TTL_MS = 5 * 60_000;
const memo = new Map<string, { at: number; value: unknown }>();

export function clearAdvisorCache(): void {
  memo.clear();
}

function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < ADVISOR_CACHE_TTL_MS) return Promise.resolve(hit.value as T);
  return load().then((value) => {
    memo.set(key, { at: Date.now(), value });
    return value;
  });
}

/** Prix médians du site pour une carte. */
export function fetchPriceSnapshot(api: Api, id: number): Promise<PriceSnapshot> {
  return cached(`price:${id}`, async () => {
    const result = await call(api, `/api/market/prices/${id}`);
    if (!result.ok) throw new Error(`Prix : ${result.message}`);
    return normalizePriceSnapshot(result.data);
  });
}

/** Ordres d'achat ouverts sur une carte. */
export function fetchBuyOrders(api: Api, id: number): Promise<BuyOrder[]> {
  return cached(`orders:${id}`, async () => {
    const result = await call(api, `/api/market/buy-orders?characterId=${id}`);
    if (!result.ok) throw new Error(`Ordres d'achat : ${result.message}`);
    return normalizeBuyOrders(result.data);
  });
}

/**
 * Annonce à prix fixe la moins chère des autres vendeurs, et le nombre d'annonces.
 * `excludeId` retire l'annonce étudiée : sans lui, un bon plan serait plafonné par
 * son propre prix et paraîtrait sans bénéfice.
 */
export function fetchCompetition(
  api: Api,
  id: number,
  excludeId?: string,
): Promise<{ lowestAsk: number | null; activeListings: number | null }> {
  return cached(`ask:${id}:${excludeId ?? ''}`, async () => {
    const result = await call(
      api,
      `/api/market/listings?type=fixed&sort=price_asc&page=1&pageSize=10&characterId=${id}`,
    );
    if (!result.ok) throw new Error(`Concurrence : ${result.message}`);
    const listings = normalizeListings(result.data).filter((listing) => listing.id !== excludeId);
    const prices = listings.map((listing) => listing.price).filter((price) => price > 0);
    const total = isRecord(result.data) ? amount(result.data.total) : null;
    return {
      lowestAsk: prices.length ? Math.min(...prices) : null,
      activeListings: total === null ? null : Math.trunc(total),
    };
  });
}

export interface MarketConfig {
  recycle: Record<string, number>;
  rules: MarketRules;
}

/** Barème et recyclage du site en un seul appel, avec repli sur les valeurs connues. */
export async function fetchMarketConfig(api: Api): Promise<MarketConfig> {
  const result = await call(api, '/api/config');
  return result.ok
    ? { recycle: recycleTable(result.data), rules: marketRules(result.data) }
    : { recycle: { ...DEFAULT_RECYCLE }, rules: { ...MARKET_RULES } };
}

/** Table de recyclage du site (`/api/config`), repli sur les valeurs connues. */
export async function fetchRecycleTable(api: Api): Promise<Record<string, number>> {
  return (await fetchMarketConfig(api)).recycle;
}
