import type { BuyOrderEntry } from './buy-orders';
import type { Sale } from './sales';
import type { Purchase } from './spend';

/**
 * Export CSV de l'historique complet, au-delà du seul CSV du jour : ventes terminées,
 * ordres d'achat envoyés et achats directs, triés du plus ancien au plus récent. Aucune
 * requête : tout vient des journaux locaux déjà tenus par l'extension.
 */

/** Lignes maximales d'un export, pour ne pas produire un fichier ingérable. */
export const HISTORY_CSV_MAX = 5_000;

const cell = (value: string): string => `"${value.replace(/"/g, '""')}"`;
const iso = (at: number): string => new Date(at).toISOString();

export interface HistoryInput {
  sales: readonly Sale[];
  orders: readonly BuyOrderEntry[];
  purchases: readonly Purchase[];
}

export interface HistoryRow {
  type: 'vente' | 'ordre' | 'achat';
  at: number;
  card: string;
  amount: number;
  detail: string;
}

/** Lignes unifiées, bornées aux plus récentes, dans l'ordre chronologique. */
export function historyRows(input: HistoryInput): HistoryRow[] {
  const rows: HistoryRow[] = [];
  for (const sale of input.sales) {
    rows.push({
      type: 'vente',
      at: sale.at,
      card: sale.name ?? `Carte #${sale.cardId}`,
      amount: sale.price,
      detail: sale.rarity ?? '',
    });
  }
  for (const order of input.orders) {
    rows.push({
      type: 'ordre',
      at: order.at,
      card: order.name ?? `Carte #${order.characterId}`,
      amount: order.price * order.qty,
      detail: `${order.qty} × ${order.price} ◆`,
    });
  }
  for (const purchase of input.purchases) {
    rows.push({
      type: 'achat',
      at: purchase.at,
      card: purchase.name ?? `Carte #${purchase.characterId}`,
      amount: purchase.price,
      detail: purchase.kind === 'auction' ? 'enchère' : 'prix fixe',
    });
  }
  return rows
    .filter((row) => row.at > 0)
    .sort((a, b) => a.at - b.at)
    .slice(-HISTORY_CSV_MAX);
}

/** CSV complet : une ligne par opération, en-tête inclus, séparateur point-virgule ? Non : virgule. */
export function historyCsv(input: HistoryInput): string {
  const rows: string[][] = [['type', 'date', 'carte', 'montant', 'detail']];
  for (const row of historyRows(input)) {
    rows.push([row.type, iso(row.at), row.card, String(row.amount), row.detail]);
  }
  return rows.map((row) => row.map(cell).join(',')).join('\r\n');
}

/** Nom de fichier daté, pour retrouver l'export dans les téléchargements. */
export function historyCsvName(now = Date.now()): string {
  const date = new Date(now);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `kyara-plus-historique-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.csv`;
}

/** Résumé lisible d'un export : nombre de lignes et total des montants. */
export function historySummary(rows: readonly HistoryRow[]): string {
  const count = (type: HistoryRow['type']): number => rows.filter((row) => row.type === type).length;
  const total = rows.reduce((sum, row) => sum + row.amount, 0);
  return `${rows.length} ligne(s) · ${count('vente')} vente(s) · ${count('ordre')} ordre(s) · ${count('achat')} achat(s) · ${total.toLocaleString('fr-FR')} ◆`;
}
