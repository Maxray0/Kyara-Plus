import { storage } from 'wxt/utils/storage';
import { listingDiscount, type MarketListing } from './market-search';

/**
 * Journal local des opportunités : les annonces ouvertes depuis le panneau sont
 * mémorisées (prix, médiane, écart, envie ou non), pour produire un bilan sans aucune
 * requête supplémentaire. Rien n'est envoyé : tout reste dans `local:opportunities`.
 */

export interface OpportunityRecord {
  id: string;
  characterId: number;
  name: string | null;
  rarity: string | null;
  price: number;
  median: number | null;
  /** Écart à la médiane en %, `null` quand la médiane manque. */
  discount: number | null;
  /** Vrai si la carte était dans les envies au moment de l'ouverture. */
  wanted: boolean;
  at: number;
}

export interface OpportunityLog {
  seen: OpportunityRecord[];
}

/** Entrées conservées : le journal est un bilan, pas un historique infini. */
export const OPPORTUNITY_MAX = 500;

export const opportunitiesItem = storage.defineItem<OpportunityLog>('local:opportunities', {
  fallback: { seen: [] },
  version: 1,
});

export function normalizeOpportunities(raw: unknown): OpportunityLog {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const rows = Array.isArray(source.seen) ? source.seen : [];
  const seen: OpportunityRecord[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const entry = row as Record<string, unknown>;
    const id = typeof entry.id === 'string' ? entry.id : String(entry.id ?? '');
    const price = Number(entry.price);
    const at = Number(entry.at);
    if (!id || !Number.isFinite(price) || price <= 0) continue;
    if (!Number.isSafeInteger(Number(entry.characterId))) continue;
    seen.push({
      id,
      characterId: Number(entry.characterId),
      name: typeof entry.name === 'string' ? entry.name : null,
      rarity: typeof entry.rarity === 'string' ? entry.rarity : null,
      price,
      median: Number(entry.median) > 0 ? Number(entry.median) : null,
      discount: Number.isFinite(Number(entry.discount)) ? Math.round(Number(entry.discount)) : null,
      wanted: entry.wanted === true,
      at: Number.isFinite(at) && at > 0 ? at : 0,
    });
  }
  return { seen: seen.slice(-OPPORTUNITY_MAX) };
}

/** Enregistre une annonce ouverte ; une même annonce n'est gardée qu'une fois. */
export async function recordOpportunity(
  listing: MarketListing,
  options: { wanted?: boolean; now?: number; store?: () => Promise<unknown>; write?: (value: OpportunityLog) => Promise<void> } = {},
): Promise<OpportunityRecord[]> {
  const now = options.now ?? Date.now();
  const read = options.store ?? (() => opportunitiesItem.getValue());
  const write = options.write ?? ((value: OpportunityLog) => opportunitiesItem.setValue(value));
  const entry: OpportunityRecord = {
    id: listing.id,
    characterId: listing.characterId,
    name: listing.name,
    rarity: listing.rarity,
    price: listing.price,
    median: listing.median,
    discount: listingDiscount(listing),
    wanted: options.wanted === true,
    at: now,
  };
  const current = normalizeOpportunities(await read().catch(() => null));
  const seen = [entry, ...current.seen.filter((item) => item.id !== entry.id)].slice(0, OPPORTUNITY_MAX);
  await write({ seen });
  return seen;
}

export interface OpportunitySummary {
  /** Annonces ouvertes mémorisées. */
  seen: number;
  /** Somme des écarts à la médiane, en points de %. */
  gapSum: number;
  /** Écart moyen observé, arrondi, `null` sans mesure. */
  gapAvg: number | null;
  /** Cartes en envies distinctes parmi les annonces ouvertes. */
  wishesCovered: number;
}

export function opportunitySummary(records: readonly OpportunityRecord[]): OpportunitySummary {
  const measured = records.filter(
    (record): record is OpportunityRecord & { discount: number } => record.discount !== null,
  );
  const gapSum = measured.reduce((total, record) => total + record.discount, 0);
  return {
    seen: records.length,
    gapSum,
    gapAvg: measured.length ? Math.round(gapSum / measured.length) : null,
    wishesCovered: new Set(records.filter((record) => record.wanted).map((record) => record.characterId))
      .size,
  };
}

export interface WishExportRow {
  name: string;
  rarity: string | null;
  median: number | null;
  /** Meilleure annonce connue pour cette carte, sinon `null`. */
  best: Pick<MarketListing, 'id' | 'price'> | null;
}

/** Échappe une cellule CSV : séparateur `;` (Excel français), guillemets doublés. */
function cell(value: string | number | null): string {
  if (value === null) return '';
  const text = String(value);
  return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * CSV des envies : nom, rareté, médiane et meilleure annonce connue. Les annonces
 * viennent de la dernière recherche affichée ; aucune requête n'est faite ici.
 */
export function wishesCsv(rows: readonly WishExportRow[]): string {
  const lines = ['Nom;Rareté;Médiane;Meilleure annonce'];
  for (const row of rows) {
    const best = row.best ? `${row.best.price} ◆ (annonce ${row.best.id})` : '';
    lines.push(
      [cell(row.name), cell(row.rarity), cell(row.median), cell(best)].join(';'),
    );
  }
  return `${lines.join('\r\n')}\r\n`;
}
