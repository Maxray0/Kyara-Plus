import { call, checkShape, fetchPrices, record, type Api, type StoredPrice } from './market';
import { computePrice, parseIds, type PriceData } from './pricing';
import type { SellSettings } from './settings';

export interface CardMeta {
  name: string | null;
  image: string | null;
  rarity: string | null;
  series: string | null;
}

export interface Candidate extends CardMeta {
  id: number;
  qty: number;
  locked: number;
  /** Exemplaires réellement vendables maintenant. */
  sellable: number;
  firstAt: string | null;
  /** Raison pour laquelle la carte ne peut pas être vendue, sinon null. */
  blocked: string | null;
  status: string;
  prices: PriceData | null;
  pricedAt: number | null;
  price: number | null;
  priceWhy: string;
  /** Prix saisi à la main : jamais recalculé. */
  manual: boolean;
  checked?: boolean;
}

const RARITY_RANK: Record<string, number> = { M: 6, L: 5, S: 5, E: 4, R: 3, U: 2, C: 1 };

const SELL_BLOCK: Record<string, string> = {
  resale_lock: 'Reçue récemment : revendable 48 h après',
  listing: 'Déjà en vente',
  listed: 'Déjà en vente',
  offer: 'Engagée dans une offre',
  trade: 'Engagée dans un échange',
  pinned: '🔒 Verrouillée avec le cadenas de Kyara',
  locked: '🔒 Verrouillée avec le cadenas de Kyara',
};

export function applyPrice(c: Candidate, s: SellSettings): void {
  if (c.manual) return;
  const { price, why } = computePrice(c.prices, s);
  c.price = price;
  c.priceWhy = price ? '' : why;
}

export function sortCandidates(list: Candidate[], s: SellSettings): Candidate[] {
  const known = (c: Candidate) => (c.price && c.price > 0 ? c.price : null);
  const byPrice = (dir: number) => (a: Candidate, b: Candidate) => {
    const pa = known(a);
    const pb = known(b);
    if (pa !== null && pb !== null) return dir * (pa - pb);
    if (pa !== null) return -1; // les prix connus d'abord
    if (pb !== null) return 1;
    return (RARITY_RANK[b.rarity ?? ''] ?? 0) - (RARITY_RANK[a.rarity ?? ''] ?? 0) || b.qty - a.qty;
  };
  const sorters: Record<SellSettings['order'], (a: Candidate, b: Candidate) => number> = {
    priceDesc: byPrice(-1),
    priceAsc: byPrice(1),
    oldest: (a, b) => String(a.firstAt).localeCompare(String(b.firstAt)),
    newest: (a, b) => String(b.firstAt).localeCompare(String(a.firstAt)),
  };
  return list.sort(
    (a, b) =>
      Number(!!a.blocked) - Number(!!b.blocked) || (sorters[s.order] ?? sorters.priceDesc)(a, b),
  );
}

export interface CandidateInputs {
  activeIds?: ReadonlySet<number>;
  holds?: ReadonlyMap<number, number>;
  meta?: ReadonlyMap<number, Partial<CardMeta>>;
  prices?: ReadonlyMap<number, StoredPrice>;
}

/** Raison d'un blocage de vente d'un exemplaire de collection (formes observées chez Kyara). */
export function blockReason(
  it: Record<string, unknown>,
  context: { id: number; sellable: number; held: number; activeIds: ReadonlySet<number> },
): string | null {
  const when = (iso: string) =>
    new Date(iso).toLocaleString('fr-CH', { weekday: 'long', hour: '2-digit', minute: '2-digit' });
  const pinned = !!(
    it.pinned ||
    it.isPinned ||
    /pin|padlock|cadenas/i.test(String(it.sellBlock ?? ''))
  );
  if (pinned) return '🔒 Verrouillée avec le cadenas de Kyara';
  if (context.activeIds.has(context.id)) return 'Déjà en vente';
  if (it.resaleLocked || it.sellBlock === 'resale_lock') {
    return it.resaleUntil
      ? `Reçue récemment : revendable à partir de ${when(String(it.resaleUntil))}`
      : 'Reçue récemment : revendable 48 h après';
  }
  if (context.held && context.sellable === 0)
    return 'Obtenu récemment, revendable un peu plus tard';
  if (it.sellBlock)
    return SELL_BLOCK[String(it.sellBlock)] ?? 'Vente bloquée par Kyara pour le moment';
  if (it.listable === 0 || it.listable === false) {
    return 'Kyara ne permet pas de vendre cette carte pour le moment';
  }
  if (context.sellable === 0) return 'Exemplaires déjà engagés dans un échange';
  return null;
}

/**
 * Liste des doublons, sans requête de prix : seuls les prix déjà mémorisés servent à l'affichage.
 * Un doublon est une carte dont on possède plus d'exemplaires que `keep`.
 */
export async function buildCandidates(api: Api, s: SellSettings, inputs: CandidateInputs = {}) {
  const result = await call(api, '/api/me/collection?lean=1');
  if (!result.ok) throw new Error(`Collection : ${result.message}`);
  const rows = Array.isArray(result.data)
    ? result.data
    : Object.values(record(result.data)).find(Array.isArray);
  await checkShape(
    'collection',
    !!rows && rows.every((it) => it && it.characterId != null && it.qty != null),
    result.data,
  );
  const items = (rows ?? []).map(record);

  const exclude = parseIds(s.exclude);
  const activeIds = inputs.activeIds ?? new Set<number>();
  const list: Candidate[] = [];
  for (const it of items) {
    const id = Number(it.characterId);
    const qty = Number(it.qty) || 0;
    if (qty <= s.keep || exclude.has(id)) continue;
    const locked = Number(it.locked) || 0;
    const held = inputs.holds?.get(id) ?? 0;
    const pinned = !!(
      it.pinned ||
      it.isPinned ||
      /pin|padlock|cadenas/i.test(String(it.sellBlock ?? ''))
    );
    const sellable = pinned ? 0 : Math.max(0, Math.min(qty - s.keep, qty - locked - held));
    const meta = inputs.meta?.get(id);
    const stored = inputs.prices?.get(id);
    const candidate: Candidate = {
      id,
      qty,
      locked,
      sellable,
      firstAt: (it.firstAt as string) ?? null,
      blocked: blockReason(it, { id, sellable, held, activeIds }),
      status: '',
      prices: stored?.data ?? null,
      pricedAt: stored?.t ?? null,
      price: null,
      priceWhy: '',
      manual: false,
      name: meta?.name ?? null,
      image: meta?.image ?? null,
      rarity: meta?.rarity ?? null,
      series: meta?.series ?? null,
    };
    if (candidate.prices) applyPrice(candidate, s);
    list.push(candidate);
  }
  return sortCandidates(list, s);
}

/** Estime les prix de tous les doublons vendables, deux requêtes à la fois. */
export async function estimatePrices(
  api: Api,
  s: SellSettings,
  list: Candidate[],
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const todo = list.filter((c) => !c.blocked);
  let done = 0;
  let next = 0;
  await Promise.all(
    Array.from({ length: 2 }, async () => {
      while (next < todo.length) {
        const c = todo[next++] as Candidate;
        try {
          c.prices = await fetchPrices(api, c.id);
          c.pricedAt = Date.now();
          applyPrice(c, s);
          if (!c.price && !c.manual) {
            c.blocked = c.priceWhy;
            c.checked = false;
          }
        } catch (error) {
          if ((error as Error).name === 'AuthError' || (error as Error).name === 'ShapeError')
            throw error;
          c.status = '❌ Prix indisponible';
        }
        done += 1;
        onProgress?.(done, todo.length);
      }
    }),
  );
  sortCandidates(list, s);
}
