import { storage } from 'wxt/utils/storage';
import { formatEndsIn } from '../doublons/market-search';
import type { Listing } from '../doublons/market';
import {
  fetchMarketOrders,
  remainingQty,
  type ClosedOrder,
  type MyOrder,
} from '../doublons/my-orders';
import type { Alert } from './model';
import { upsertAlerts } from './store';

/**
 * Alertes de portefeuille, 100 % locales : un ordre d'achat qui se remplit et une de mes
 * annonces qui arrive à échéance. Aucune écriture de jeu, aucune notification système.
 */

/** Fenêtre avant la fin d'une annonce où l'alerte apparaît. */
export const LISTING_ALERT_HORIZON_MS = 2 * 60 * 60_000;

export interface OrderSnapshot {
  id: string;
  characterId: number;
  name: string | null;
  price: number;
  qty: number;
  filled: number;
}

export const orderSnapshotItem = storage.defineItem<{ orders: OrderSnapshot[] }>(
  'local:orderSnapshot',
  { fallback: { orders: [] }, version: 1 },
);

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

export function normalizeSnapshot(raw: unknown): OrderSnapshot[] {
  const source = record(raw);
  const rows = Array.isArray(source.orders) ? source.orders : [];
  const orders: OrderSnapshot[] = [];
  for (const row of rows) {
    const order = record(row);
    const id = String(order.id ?? '');
    const price = Number(order.price);
    const qty = Number(order.qty);
    if (!id || !Number.isFinite(price) || price <= 0) continue;
    if (!Number.isSafeInteger(qty) || qty < 1) continue;
    orders.push({
      id,
      characterId: Number(order.characterId) || 0,
      name: typeof order.name === 'string' ? order.name : null,
      price,
      qty,
      filled: Math.min(qty, Math.max(0, Number(order.filled) || 0)),
    });
  }
  return orders;
}

const snapshotOf = (order: MyOrder): OrderSnapshot => ({
  id: order.id,
  characterId: order.characterId,
  name: order.name,
  price: order.price,
  qty: order.qty,
  filled: order.filled,
});

function orderHref(order: { characterId: number }): string {
  return order.characterId > 0
    ? `https://kyara.games/wiki/${order.characterId}`
    : 'https://kyara.games/marche';
}

/**
 * Compare les ordres ouverts connus aux ordres actuels : une quantité remplie en plus devient
 * une alerte. Un ordre disparu n'alerte que si le site le donne pour `filled` ; un ordre
 * annulé ou absent (statut inconnu) ne produit rien.
 */
export function filledAlerts(
  previous: readonly OrderSnapshot[],
  current: readonly MyOrder[],
  closed: readonly ClosedOrder[] = [],
  now = Date.now(),
): Alert[] {
  const byId = new Map(current.map((order) => [order.id, order]));
  const closedById = new Map(closed.map((order) => [order.id, order.status]));
  const alerts: Alert[] = [];
  for (const old of previous) {
    const live = byId.get(old.id);
    const status = closedById.get(old.id);
    // Disparu : seule une clôture `filled` atteste l'achat, pas une annulation.
    if (!live && status !== 'filled') continue;
    const filled = live ? live.filled : old.qty;
    const gained = filled - old.filled;
    if (gained <= 0) continue;
    const name = live?.name ?? old.name ?? `Carte #${old.characterId}`;
    const complet = filled >= (live?.qty ?? old.qty);
    alerts.push({
      key: `order:filled:${old.id}:${filled}`,
      kind: 'order',
      title: complet ? `Ordre rempli : ${name}` : `Ordre partiellement rempli : ${name}`,
      message: `${gained} exemplaire(s) acheté(s) à ${old.price.toLocaleString('fr-FR')} ◆`,
      at: now,
      read: false,
      href: orderHref(old),
    });
  }
  return alerts;
}

/** Mes annonces qui se terminent dans l'horizon, une alerte par annonce. */
export function expiringAlerts(
  listings: readonly Listing[],
  now = Date.now(),
  horizonMs = LISTING_ALERT_HORIZON_MS,
): Alert[] {
  const alerts: Alert[] = [];
  for (const listing of listings) {
    const endsAt = listing.endsAt ? Date.parse(listing.endsAt) : Number.NaN;
    if (!Number.isFinite(endsAt)) continue;
    const left = endsAt - now;
    if (left <= 0 || left > horizonMs) continue;
    const name = listing.name ?? `Carte #${listing.characterId}`;
    alerts.push({
      key: `listing:expiring:${listing.id}`,
      kind: 'market',
      title: `Annonce bientôt terminée : ${name}`,
      message: `${listing.price.toLocaleString('fr-FR')} ◆ · ${formatEndsIn(listing.endsAt)}`,
      at: now,
      read: false,
      href: `https://kyara.games/marche?annonce=${encodeURIComponent(listing.id)}`,
    });
  }
  return alerts;
}

export async function notifyExpiringListings(
  listings: readonly Listing[],
  now = Date.now(),
): Promise<Alert[]> {
  const alerts = expiringAlerts(listings, now);
  if (!alerts.length) return [];
  return upsertAlerts(alerts, now);
}

/**
 * Relit mes ordres, émet les alertes de remplissage depuis le dernier passage puis
 * mémorise l'état courant. Renvoie aussi les ordres, pour la liste du panneau.
 */
export async function syncOrderAlerts(
  api: Parameters<typeof fetchMarketOrders>[0],
  now = Date.now(),
): Promise<{ orders: MyOrder[]; alerts: Alert[]; remaining: number }> {
  const previous = normalizeSnapshot(
    await orderSnapshotItem.getValue().catch(() => null),
  );
  const { open: orders, closed } = await fetchMarketOrders(api);
  const alerts = filledAlerts(previous, orders, closed, now);
  await orderSnapshotItem.setValue({ orders: orders.map(snapshotOf) }).catch(() => undefined);
  if (alerts.length) await upsertAlerts(alerts, now);
  return {
    orders,
    alerts,
    remaining: orders.reduce((total, order) => total + remainingQty(order), 0),
  };
}
