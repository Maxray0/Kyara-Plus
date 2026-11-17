import { loadAlerts } from '../alerts/store';
import type { Alert } from '../alerts/model';
import { ordersSpentToday, type BuyOrderEntry } from './buy-orders';
import { dayStart } from './buy-plan';
import type { Listing } from './market';
import type { MyOrder } from './my-orders';
import { LISTINGS_SOON_MS, remainingMs } from './my-listings';
import type { Sale } from './sales';

/**
 * Tableau de bord du jour : synthèse locale des ventes, ordres, annonces qui finissent et
 * meilleures alertes de la veille. Aucune requête d'écriture, aucun prix inventé : tout
 * vient des caches locaux et de la lecture du marché déjà faite par le panneau.
 */

/** Nombre d'alertes de veille reprises dans les opportunités. */
export const DASHBOARD_OPPORTUNITIES = 5;

export interface DashboardExpiring {
  id: string;
  name: string | null;
  price: number;
  leftMs: number;
}

export interface DashboardDay {
  sales: { count: number; proceeds: number };
  orders: { count: number; spent: number; open: number; remainingValue: number };
  expiring: DashboardExpiring[];
  opportunities: Alert[];
}

export interface DashboardInput {
  sales: readonly Sale[];
  orders: readonly BuyOrderEntry[];
  openOrders: readonly MyOrder[];
  listings: readonly Listing[];
  alerts: readonly Alert[];
  now?: number;
}

/** Agrège la journée en cours : ventes et ordres depuis minuit, annonces à moins de 2 h. */
export function dashboardDay(input: DashboardInput): DashboardDay {
  const now = input.now ?? Date.now();
  const midnight = dayStart(now);
  const salesToday = input.sales.filter((sale) => sale.at >= midnight);
  const ordersToday = input.orders.filter((entry) => entry.at >= midnight);
  const expiring: DashboardExpiring[] = [];
  for (const listing of input.listings) {
    const leftMs = remainingMs(listing, now);
    if (leftMs <= 0 || leftMs > 2 * 3_600_000) continue;
    expiring.push({ id: listing.id, name: listing.name, price: listing.price, leftMs });
  }
  expiring.sort((a, b) => a.leftMs - b.leftMs);
  return {
    sales: {
      count: salesToday.length,
      proceeds: salesToday.reduce((total, sale) => total + sale.price, 0),
    },
    orders: {
      count: ordersToday.length,
      spent: ordersSpentToday(ordersToday, now),
      open: input.openOrders.length,
      remainingValue: input.openOrders.reduce(
        (total, order) => total + order.price * Math.max(0, order.qty - order.filled),
        0,
      ),
    },
    expiring,
    opportunities: [...input.alerts]
      .filter((alert) => alert.kind === 'market' || alert.kind === 'order')
      .sort((a, b) => Number(a.read) - Number(b.read) || b.at - a.at)
      .slice(0, DASHBOARD_OPPORTUNITIES),
  };
}

/** Résumé d'une journée pour la cloche, une fois par jour. */
export function dailyRecapAlert(day: DashboardDay, now = Date.now()): Alert | null {
  if (!day.sales.count && !day.orders.count && !day.expiring.length) return null;
  const date = new Date(now);
  const key = `day:${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
  const parts = [
    day.sales.count ? `${day.sales.count} vente(s) pour ${day.sales.proceeds} ◆` : '',
    day.orders.count ? `${day.orders.count} ordre(s) pour ${day.orders.spent} ◆` : '',
    day.expiring.length ? `${day.expiring.length} annonce(s) bientôt finie(s)` : '',
  ].filter(Boolean);
  return {
    key,
    kind: 'market',
    title: 'Ton résumé du jour',
    message: parts.join(' · '),
    at: now,
    read: false,
    href: 'https://kyara.games/marche',
  };
}

const csvCell = (value: string): string => `"${value.replace(/"/g, '""')}"`;

/** CSV du jour : une ligne par vente puis par ordre, en-tête inclus. */
export function dashboardCsv(input: DashboardInput, day: DashboardDay): string {
  const now = input.now ?? Date.now();
  const midnight = dayStart(now);
  const rows: string[][] = [['type', 'carte', 'prix', 'quand']];
  for (const sale of input.sales) {
    if (sale.at < midnight) continue;
    rows.push(['vente', sale.name ?? `Carte #${sale.cardId}`, String(sale.price), new Date(sale.at).toISOString()]);
  }
  for (const entry of input.orders) {
    if (entry.at < midnight) continue;
    rows.push([
      'ordre',
      entry.name ?? `Carte #${entry.characterId}`,
      String(entry.price * entry.qty),
      new Date(entry.at).toISOString(),
    ]);
  }
  for (const listing of day.expiring) {
    rows.push(['annonce', listing.name ?? `Carte #${listing.id}`, String(listing.price), 'bientôt finie']);
  }
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
}

/** Libellé court du reste de temps, pour le tableau de bord. */
export function shortLeft(leftMs: number): string {
  if (leftMs <= 0) return 'terminée';
  if (leftMs > LISTINGS_SOON_MS) {
    return `${Math.floor(leftMs / 3_600_000)} h`;
  }
  return `${Math.max(1, Math.round(leftMs / 60_000))} min`;
}

export async function dashboardAlerts(now = Date.now()): Promise<Alert[]> {
  return loadAlerts(now);
}
