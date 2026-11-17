import type { BuyOrderEntry } from './buy-orders';
import type { Listing } from './market';
import type { Sale } from './sales';

/**
 * Vue « Mes annonces » : reste de durée des annonces actives, relance au même prix
 * (via le repix existant) et bénéfice réalisé sur les ventes terminées. Le coût d'une
 * carte est le prix du dernier ordre d'achat connu ; sans achat connu, le bénéfice
 * reste inconnu plutôt que deviné.
 */

/** Une annonce à moins de six heures de sa fin est signalée. */
export const LISTINGS_SOON_MS = 6 * 3_600_000;

export interface ActiveListingRow {
  listing: Listing;
  /** Millisecondes restantes, toujours strictement positives. */
  leftMs: number;
  soon: boolean;
}

/** Millisecondes restantes avant la fin d'une annonce, 0 si l'échéance est inconnue ou passée. */
export function remainingMs(listing: Listing, now = Date.now()): number {
  if (!listing.endsAt) return 0;
  const at = Date.parse(listing.endsAt);
  if (!Number.isFinite(at)) return 0;
  return Math.max(0, at - now);
}

/** Annonces encore actives, de la plus proche de sa fin à la plus lointaine. */
export function activeRows(listings: readonly Listing[], now = Date.now()): ActiveListingRow[] {
  const rows: ActiveListingRow[] = [];
  for (const listing of listings) {
    const leftMs = remainingMs(listing, now);
    if (leftMs <= 0) continue;
    rows.push({ listing, leftMs, soon: leftMs <= LISTINGS_SOON_MS });
  }
  return rows.sort((a, b) => a.leftMs - b.leftMs);
}

/** Prix du dernier achat connu par carte ; les entrées sont chronologiques. */
export function costByCard(entries: readonly BuyOrderEntry[]): Map<number, number> {
  const costs = new Map<number, number>();
  for (const entry of entries) {
    if (!Number.isSafeInteger(entry.characterId) || entry.characterId <= 0) continue;
    if (!Number.isFinite(entry.price) || entry.price <= 0) continue;
    costs.set(entry.characterId, entry.price);
  }
  return costs;
}

export interface SoldRow {
  sale: Sale;
  /** Coût unitaire connu, sinon `null`. */
  cost: number | null;
  /** Bénéfice unitaire (`price - cost`), sinon `null`. */
  profit: number | null;
}

/** Ventes les plus récentes d'abord, bénéfice calculé quand le prix d'achat est connu. */
export function soldRows(
  sales: readonly Sale[],
  costs: ReadonlyMap<number, number>,
  limit = 12,
): SoldRow[] {
  return [...sales]
    .sort((a, b) => b.at - a.at)
    .slice(0, Math.max(0, Math.floor(limit)))
    .map((sale) => {
      const cost = costs.get(sale.cardId) ?? null;
      return { sale, cost, profit: cost === null ? null : sale.price - cost };
    });
}

export interface ProfitSummary {
  /** Somme encaissée sur les ventes affichées. */
  proceeds: number;
  /** Bénéfice connu sur ces ventes (les ventes sans coût comptent 0). */
  profit: number;
  /** Ventes dont le prix d'achat est connu. */
  matched: number;
  /** Ventes sans prix d'achat connu. */
  unknown: number;
}

export function profitSummary(rows: readonly SoldRow[]): ProfitSummary {
  let proceeds = 0;
  let profit = 0;
  let matched = 0;
  let unknown = 0;
  for (const row of rows) {
    proceeds += row.sale.price;
    if (row.profit === null) {
      unknown += 1;
      continue;
    }
    matched += 1;
    profit += row.profit;
  }
  return { proceeds, profit, matched, unknown };
}
