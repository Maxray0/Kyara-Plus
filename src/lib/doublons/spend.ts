import { storage } from 'wxt/utils/storage';
import type { BuyPlan } from './buy-plan';
import { dayStart } from './buy-plan';
import { ordersSpentToday, type BuyOrderEntry } from './buy-orders';

/**
 * Dépenses réelles de la journée, en un seul endroit : ordres d'achat envoyés et achats
 * directs (prix fixe, enchère). Les deux vues (Achat → Ordres, « Aujourd'hui ») lisaient
 * chacune une moitié ; elles partagent maintenant le même compteur et le même plafond.
 */

export interface Purchase {
  at: number;
  characterId: number;
  name: string | null;
  price: number;
  kind: 'listing' | 'auction';
  /** Enchère : annonce concernée, pour ne compter chaque enchère qu'une seule fois. */
  listingId?: string;
  /**
   * Enchère en tête mais pas encore gagnée : l'argent est engagé, ce n'est pas un achat.
   * L'entrée devient un achat quand la carte finit dans la collection.
   */
  pending?: boolean;
}

export interface Purchases {
  entries: Purchase[];
}

export const PURCHASES_MAX = 500;

export const purchasesItem = storage.defineItem<Purchases>('local:purchases', {
  fallback: { entries: [] },
  version: 1,
});

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

export function normalizePurchases(raw: unknown): Purchases {
  const rows = Array.isArray(record(raw).entries) ? (record(raw).entries as unknown[]) : [];
  const byListing = new Map<string, number>();
  const entries: Purchase[] = [];
  for (const row of rows) {
    const entry = record(row);
    const at = Number(entry.at);
    const price = Number(entry.price);
    const characterId = Number(entry.characterId);
    if (!Number.isFinite(at) || at <= 0) continue;
    if (!Number.isFinite(price) || price <= 0) continue;
    const listingId =
      typeof entry.listingId === 'string' && entry.listingId.trim()
        ? entry.listingId.trim().slice(0, 80)
        : undefined;
    const purchase: Purchase = {
      at,
      characterId: Number.isSafeInteger(characterId) && characterId > 0 ? characterId : 0,
      name: typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim().slice(0, 80) : null,
      price: Math.round(price),
      kind: entry.kind === 'auction' ? 'auction' : 'listing',
      ...(listingId ? { listingId } : {}),
      ...(entry.pending === true ? { pending: true } : {}),
    };
    // Une même enchère rejouée ne crée pas une seconde ligne : la dernière mise gagne.
    const index = listingId ? byListing.get(listingId) : undefined;
    if (index !== undefined) {
      entries[index] = purchase;
      continue;
    }
    if (listingId) byListing.set(listingId, entries.length);
    entries.push(purchase);
  }
  return { entries: entries.slice(-PURCHASES_MAX) };
}

/** Ajoute un achat réel au journal local, borné aux 500 derniers. */
export function addPurchase(
  raw: Purchases,
  purchase: Omit<Purchase, 'at'> & { at?: number },
  now = Date.now(),
): Purchases {
  const entry: Purchase = {
    ...purchase,
    at: purchase.at ?? now,
    price: Math.max(1, Math.round(purchase.price)),
  };
  const current = normalizePurchases(raw).entries;
  // Même enchère : la ligne est remplacée (montant à jour), jamais dupliquée.
  const index = purchase.listingId
    ? current.findIndex((row) => row.listingId === purchase.listingId)
    : -1;
  if (index >= 0) {
    const entries = [...current];
    entries[index] = entry;
    return { entries };
  }
  return { entries: [...current, entry].slice(-PURCHASES_MAX) };
}

/** Achats réellement conclus aujourd'hui (une enchère en tête n'en est pas un). */
export function purchasesToday(raw: Purchases, now = Date.now()): Purchase[] {
  const midnight = dayStart(now);
  return normalizePurchases(raw).entries.filter(
    (entry) => entry.at >= midnight && entry.pending !== true,
  );
}

/** Enchères en tête du jour, argent engagé mais pas encore dépensé. */
export function auctionsEngagedToday(raw: Purchases, now = Date.now()): Purchase[] {
  const midnight = dayStart(now);
  return normalizePurchases(raw).entries.filter(
    (entry) => entry.pending === true && entry.kind === 'auction' && entry.at >= midnight,
  );
}

/**
 * Confirme une enchère gagnée : la mise en tête devient un achat, une seule fois.
 * Sans `listingId` connu, rien n'est changé.
 */
export function confirmAuction(raw: Purchases, listingId: string, at?: number): Purchases {
  const key = listingId.trim();
  if (!key) return normalizePurchases(raw);
  const entries = normalizePurchases(raw).entries.map((entry) =>
    entry.listingId === key
      ? { ...entry, pending: false, ...(at === undefined ? {} : { at }) }
      : entry,
  );
  return { entries };
}

/**
 * Confirme les enchères dont la carte est désormais possédée : c'est la seule preuve
 * locale qu'une enchère est gagnée. Les cartes déjà possédées au moment de la mise ne
 * sont jamais mises en attente, donc aucun faux positif n'est créé ici.
 */
export function confirmWonAuctions(
  raw: Purchases,
  ownedIds: ReadonlySet<number>,
): { purchases: Purchases; confirmed: Purchase[] } {
  const confirmed: Purchase[] = [];
  const entries = normalizePurchases(raw).entries.map((entry) => {
    if (entry.pending !== true || !ownedIds.has(entry.characterId)) return entry;
    const next = { ...entry, pending: false };
    confirmed.push(next);
    return next;
  });
  return { purchases: { entries }, confirmed };
}

/** Argent dépensé aujourd'hui en achats directs. */
export function purchasesSpentToday(raw: Purchases, now = Date.now()): number {
  return purchasesToday(raw, now).reduce((total, entry) => total + entry.price, 0);
}

export interface DaySpend {
  orders: number;
  /** Achats conclus : prix fixe et enchères gagnées. */
  purchases: number;
  /** Enchères en tête, argent engagé mais pas encore dépensé. */
  auctions: number;
  total: number;
  limit: number | null;
  left: number | null;
}

/** Dépense du jour, ordres et achats directs réunis, comparée au plafond du plan. */
export function daySpend(input: {
  orders: readonly BuyOrderEntry[];
  purchases: Purchases;
  plan?: BuyPlan | null;
  now?: number;
}): DaySpend {
  const now = input.now ?? Date.now();
  const orders = ordersSpentToday(input.orders, now);
  const purchases = purchasesSpentToday(input.purchases, now);
  // L'argent d'une enchère en tête est réservé par le site : il compte dans le plafond,
  // mais il est affiché à part tant que l'enchère n'est pas gagnée.
  const auctions = auctionsEngagedToday(input.purchases, now).reduce(
    (total, entry) => total + entry.price,
    0,
  );
  const limit = input.plan ? Math.max(0, Math.trunc(input.plan.maxPerDay)) : null;
  const total = orders + purchases + auctions;
  return {
    orders,
    purchases,
    auctions,
    total,
    limit,
    left: limit === null ? null : Math.max(0, limit - total),
  };
}

/** Refus lisible quand un achat direct dépasserait le plafond du jour, sinon `null`. */
export function spendProblem(spend: DaySpend, amount: number): string | null {
  const price = Math.max(0, Math.round(amount));
  if (spend.limit === null) return null;
  if (spend.total + price > spend.limit) {
    return `Plafond du jour dépassé : ${spend.total} ◆ déjà engagés, ${price} ◆ demandés, ${spend.limit} ◆ autorisés.`;
  }
  return null;
}
