import { storage } from 'wxt/utils/storage';

/** Vente terminée retenue pour les statistiques locales. */
export interface Sale {
  /** Identifiant de l'annonce, utilisé pour ne compter chaque vente qu'une fois. */
  id: string;
  cardId: number;
  name: string | null;
  rarity: string | null;
  price: number;
  /** Date de fin de la vente, bornée à l'instant de la lecture. */
  at: number;
}

export type SaleStore = Record<string, Sale>;

/** Durée de conservation de l'historique local, au-delà des 30 jours affichés. */
export const SALES_RETENTION_DAYS = 90;
/** Plafond de sécurité pour un compte qui vend beaucoup sur la période conservée. */
export const SALES_MAX = 1_000;

export interface SalesPeriod {
  count: number;
  total: number;
}

export interface SalesDay extends SalesPeriod {
  at: number;
}

export interface SalesSummary {
  today: SalesPeriod;
  week: SalesPeriod;
  month: SalesPeriod;
  /** Les 14 derniers jours, du plus ancien à aujourd'hui. */
  days: SalesDay[];
  /** Les trois meilleures ventes des 30 derniers jours. */
  top: Sale[];
}

export const salesItem = storage.defineItem<SaleStore>('local:sales', {
  fallback: {},
});

const DAY = 86_400_000;
const CANCELED = /cancel|expir|annul/i;
const SOLD = /sold|vendu|completed|done/i;

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const positive = (value: unknown): number => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
};

const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);

/** Prix d'une annonce terminée : prix final, sinon prix courant d'une vente confirmée. */
export function soldPrice(raw: Record<string, unknown>): number {
  const finalPrice = positive(raw.finalPrice);
  if (finalPrice > 0) return finalPrice;
  if (!SOLD.test(String(raw.status ?? ''))) return 0;
  return positive(raw.currentBid) || positive(raw.buyoutPrice) || positive(raw.price);
}

function soldAt(raw: Record<string, unknown>, now: number): number {
  for (const key of ['soldAt', 'finishedAt', 'closedAt', 'updatedAt', 'endsAt']) {
    const value = raw[key];
    if (!value) continue;
    const parsed = Date.parse(String(value));
    if (Number.isFinite(parsed) && parsed > 0) return Math.min(parsed, now);
  }
  return now;
}

function cleanSale(value: unknown): Sale | null {
  const raw = asRecord(value);
  const id = String(raw.id ?? '');
  const price = positive(raw.price);
  const at = Number(raw.at);
  if (!id || !price || !Number.isFinite(at) || at <= 0) return null;
  const cardId = Number(raw.cardId);
  return {
    id,
    cardId: Number.isFinite(cardId) ? cardId : 0,
    name: text(raw.name),
    rarity: text(raw.rarity),
    price,
    at,
  };
}

/** Annonces terminées d'une réponse marché, sans doublon interne ni vente annulée. */
export function extractSales(listings: readonly unknown[], now = Date.now()): Sale[] {
  const sales: Sale[] = [];
  for (const item of listings) {
    const raw = asRecord(item);
    if (raw.isMine === false) continue;
    const status = String(raw.status ?? '');
    if (status === 'active' || CANCELED.test(status)) continue;
    const price = soldPrice(raw);
    if (!price) continue;
    const id = raw.id;
    if (id === null || id === undefined || String(id) === '') continue;
    const character = asRecord(raw.character);
    const cardId = Number(character.id ?? raw.characterId);
    sales.push({
      id: String(id),
      cardId: Number.isFinite(cardId) ? cardId : 0,
      name: text(character.name),
      rarity: text(character.rarity),
      price,
      at: soldAt(raw, now),
    });
  }
  return sales;
}

/**
 * Ne garde que les ventes des 90 derniers jours, puis les 1 000 plus récentes.
 * Le résumé n'utilise que 30 jours ; cette marge permet de corriger un historique
 * sans laisser grossir indéfinement `storage.local`.
 */
export function pruneSales(store: SaleStore, now = Date.now()): SaleStore {
  const cutoff = now - SALES_RETENTION_DAYS * DAY;
  const kept = Object.values(store)
    .map(cleanSale)
    .filter((sale): sale is Sale => sale !== null && sale.at >= cutoff && sale.at <= now)
    .sort((a, b) => b.at - a.at)
    .slice(0, SALES_MAX);
  const pruned: SaleStore = {};
  for (const sale of kept) pruned[sale.id] = sale;
  return pruned;
}

/** Fusionne les nouvelles ventes avec l'historique, sans réécrire une annonce déjà connue. */
export function mergeSales(
  existing: SaleStore,
  listings: readonly unknown[],
  now = Date.now(),
): { store: SaleStore; added: Sale[] } {
  const merged: SaleStore = {};
  for (const value of Object.values(existing)) {
    const sale = cleanSale(value);
    if (sale) merged[sale.id] = sale;
  }
  const added: Sale[] = [];
  for (const sale of extractSales(listings, now)) {
    if (merged[sale.id]) continue;
    merged[sale.id] = sale;
    added.push(sale);
  }
  const store = pruneSales(merged, now);
  return { store, added: added.filter((sale) => Boolean(store[sale.id])) };
}

/** Enregistre les ventes terminées ; un échec de stockage ne bloque jamais le marché. */
export async function recordSales(listings: readonly unknown[], now = Date.now()): Promise<Sale[]> {
  try {
    const existing = await salesItem.getValue();
    const { store, added } = mergeSales(existing, listings, now);
    const before = Object.keys(existing);
    const pruned = before.length !== Object.keys(store).length || before.some((id) => !store[id]);
    // Une échéance dépassée doit aussi disparaître quand aucune vente n'est ajoutée.
    if (added.length || pruned) await salesItem.setValue(store);
    return added;
  } catch {
    return [];
  }
}

/** Historique borné, trié du plus ancien au plus récent. */
export async function getSales(now = Date.now()): Promise<Sale[]> {
  try {
    return Object.values(pruneSales(await salesItem.getValue(), now)).sort((a, b) => a.at - b.at);
  } catch {
    return [];
  }
}

const startOfDay = (at: number): number => {
  const date = new Date(at);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
};

/** Totaux d'aujourd'hui, 7 jours, 30 jours, graphique de 14 jours et top 3. */
export function summarizeSales(sales: readonly Sale[], now = Date.now()): SalesSummary {
  const start = startOfDay(now);
  const period = (from: number): SalesPeriod => {
    let count = 0;
    let total = 0;
    for (const sale of sales) {
      if (sale.at < from || sale.at > now) continue;
      count += 1;
      total += sale.price;
    }
    return { count, total };
  };
  const days: SalesDay[] = [];
  for (let i = 13; i >= 0; i -= 1) {
    const at = start - i * DAY;
    let count = 0;
    let total = 0;
    for (const sale of sales) {
      if (sale.at < at || sale.at >= at + DAY) continue;
      count += 1;
      total += sale.price;
    }
    days.push({ at, count, total });
  }
  const monthStart = start - 29 * DAY;
  const top = sales
    .filter((sale) => sale.at >= monthStart && sale.at <= now)
    .sort((a, b) => b.price - a.price)
    .slice(0, 3);
  return {
    today: period(start),
    week: period(start - 6 * DAY),
    month: period(monthStart),
    days,
    top,
  };
}
