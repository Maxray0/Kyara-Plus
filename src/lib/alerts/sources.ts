import type { TradeBoard, TradeDeal, TradeOffer } from '../doublons/trades';
import type { CatalogCard } from '../stats/model';
import type { Alert } from './model';
import { upsertAlerts } from './store';

/** Page des offres d'échange sur Kyara. */
export const OFFERS_ALERT_HREF = 'https://kyara.games/marche?onglet=offres';

/**
 * Lien vers une offre précise. Le site ne charge l'offre que via son paramètre `offre` ;
 * l'ancre `#offre-…` reste présente pour que l'extension puisse la mettre en évidence.
 */
export function offerAlertHref(offerId: string): string {
  const id = encodeURIComponent(offerId);
  return `${OFFERS_ALERT_HREF}&offre=${id}#offre-${id}`;
}

function cardNames(catalog: readonly CatalogCard[]): Map<number, string> {
  const names = new Map<number, string>();
  for (const card of catalog) {
    const id = Number(card.id);
    if (Number.isSafeInteger(id)) names.set(id, card.name || `Carte #${id}`);
  }
  return names;
}

function cardName(names: ReadonlyMap<number, string>, id: number): string {
  return names.get(id) ?? `Carte #${id}`;
}

function eventAt(value: string | null, now: number): number {
  const time = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(time) && time > 0 ? Math.min(time, now) : now;
}

function usableOffer(board: TradeBoard, offer: TradeOffer, now: number): boolean {
  if (offer.status && offer.status !== 'open') return false;
  if (board.myId && offer.userId === board.myId) return false;
  if (offer.expiresAt) {
    const expires = Date.parse(offer.expiresAt);
    if (Number.isFinite(expires) && expires < now) return false;
  }
  return true;
}

function wantedLabel(names: ReadonlyMap<number, string>, offer: TradeOffer): string {
  const cards = offer.wantIds.map((id) => cardName(names, id));
  if (!cards.length) return 'une autre carte';
  if (cards.length <= 2) return cards.join(' ou ');
  return `${cards.slice(0, 2).join(', ')} (+${cards.length - 2})`;
}

function tradeAlert(
  deal: TradeDeal,
  offer: TradeOffer,
  names: ReadonlyMap<number, string>,
  now: number,
): Alert {
  const left = cardName(names, deal.leftId);
  const give = cardName(names, deal.giveId);
  const gain = Math.max(0, Math.round(deal.gain));
  return {
    key: `trade:${deal.offerId}`,
    kind: 'trade',
    title: `Bon échange : ${left} contre ${give}`,
    message: `${offer.userPseudo ?? 'Un joueur'} · gain estimé ${gain.toLocaleString('fr-FR')} ◆`,
    at: eventAt(offer.createdAt, now),
    read: false,
    href: offerAlertHref(deal.offerId),
    cardId: deal.leftId,
  };
}

function wishlistAlert(offer: TradeOffer, names: ReadonlyMap<number, string>, now: number): Alert {
  const left = cardName(names, offer.characterId);
  return {
    key: `wishlist:trade:${offer.id}`,
    kind: 'wishlist',
    title: `${left} est proposée en échange`,
    message: `${offer.userPseudo ?? 'Un joueur'} demande ${wantedLabel(names, offer)}`,
    at: eventAt(offer.createdAt, now),
    read: false,
    href: offerAlertHref(offer.id),
    wishlist: true,
    cardId: offer.characterId,
  };
}

/**
 * Transforme une lecture du comptoir en alertes locales :
 * - une carte de la wishlist proposée par un autre joueur ;
 * - un bon échange calculé avec les réglages courants.
 *
 * Les offres fermées, expirées ou créées par moi sont ignorées. Aucun appel réseau
 * supplémentaire n'est fait ici et aucune notification système n'est créée.
 */
export function tradeAlerts(
  board: TradeBoard,
  wishlist: readonly number[],
  catalog: readonly CatalogCard[],
  now = Date.now(),
): Alert[] {
  const names = cardNames(catalog);
  const wishes = new Set(wishlist.map(Number));
  const byId = new Map(board.offers.map((offer) => [offer.id, offer]));
  const alerts: Alert[] = [];

  for (const offer of board.offers) {
    if (!usableOffer(board, offer, now)) continue;
    if (!wishes.has(offer.characterId)) continue;
    if ((board.cards.owned.get(offer.characterId) ?? 0) > 0) continue;
    alerts.push(wishlistAlert(offer, names, now));
  }

  for (const deal of board.deals) {
    const offer = byId.get(deal.offerId);
    if (!offer || !usableOffer(board, offer, now)) continue;
    if ((board.cards.owned.get(deal.leftId) ?? 0) > 0) continue;
    alerts.push(tradeAlert(deal, offer, names, now));
  }

  return alerts;
}

/** Enregistre les alertes d'une lecture du comptoir sans jamais bloquer cette lecture. */
export async function recordTradeAlerts(
  board: TradeBoard,
  wishlist: readonly number[],
  catalog: readonly CatalogCard[],
  now = Date.now(),
): Promise<Alert[]> {
  return upsertAlerts(tradeAlerts(board, wishlist, catalog, now), now);
}
