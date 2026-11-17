import { ApiError, AuthError, PassRequiredError, type ApiClient } from '../api';

/**
 * Mes ordres d'achat : lecture de `/api/me/market` (même source que les pages du site),
 * filtre des ordres ouverts, statut des ordres fermés et annulation. Aucune autre écriture.
 */

export type Api = Pick<ApiClient, 'request'>;

export interface MyOrder {
  id: string;
  characterId: number;
  name: string | null;
  rarity: string | null;
  price: number;
  /** Quantité demandée. */
  qty: number;
  /** Quantité déjà remplie. */
  filled: number;
  status: string;
  createdAt: string | null;
}

/** Ordre fermé côté site : seul `filled` atteste un achat. */
export interface ClosedOrder {
  id: string;
  status: string;
}

export interface MarketOrders {
  /** Ordres encore ouverts, annulables. */
  open: MyOrder[];
  /** Ordres fermés, avec leur statut (`filled`, `cancelled`…). */
  closed: ClosedOrder[];
}

/** Statuts qui ne sont plus ouverts : l'ordre ne peut plus être annulé. */
const CLOSED = new Set(['filled', 'cancelled', 'canceled', 'expired', 'closed']);

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/** Lit les ordres ouverts et garde le statut des ordres fermés, pour distinguer un achat
 * d'une annulation. */
export function readMarketOrders(raw: unknown): MarketOrders {
  const source = record(raw);
  const rows = Array.isArray(source.buyOrders)
    ? source.buyOrders
    : Array.isArray(raw)
      ? (raw as unknown[])
      : [];
  const open: MyOrder[] = [];
  const closed: ClosedOrder[] = [];
  for (const row of rows) {
    const order = record(row);
    const character = record(order.character);
    const status = String(order.status ?? '').toLowerCase();
    const id = String(order.id ?? '');
    if (!id) continue;
    if (CLOSED.has(status)) {
      closed.push({ id, status });
      continue;
    }
    const price = Number(order.price);
    const qty = Number(order.qty);
    if (!Number.isFinite(price) || price <= 0) continue;
    if (!Number.isSafeInteger(qty) || qty < 1) continue;
    open.push({
      id,
      characterId: Number(character.id ?? order.characterId) || 0,
      name: typeof character.name === 'string' ? character.name : null,
      rarity: typeof character.rarity === 'string' ? character.rarity : null,
      price,
      qty,
      filled: Math.min(qty, Math.max(0, Number(order.filled) || 0)),
      status: status || 'open',
      createdAt: typeof order.createdAt === 'string' ? order.createdAt : null,
    });
  }
  return { open, closed };
}

export function normalizeMyOrders(raw: unknown): MyOrder[] {
  return readMarketOrders(raw).open;
}

/** Quantité encore en attente sur un ordre. */
export function remainingQty(order: MyOrder): number {
  return Math.max(0, order.qty - order.filled);
}

/** Somme immobilisée par les ordres ouverts (prix × quantité restante). */
export function ordersValue(orders: readonly MyOrder[]): number {
  return orders.reduce((total, order) => total + order.price * remainingQty(order), 0);
}

export async function fetchMarketOrders(api: Api): Promise<MarketOrders> {
  const data = await api.request<unknown>('/api/me/market');
  return readMarketOrders(data);
}

export async function fetchMyOrders(api: Api): Promise<MyOrder[]> {
  return (await fetchMarketOrders(api)).open;
}

export interface CancelOrderResult {
  ok: boolean;
  message: string;
}

/** Annule un ordre ouvert ; une erreur du site est rendue comme un résultat. */
export async function cancelBuyOrder(api: Api, id: string): Promise<CancelOrderResult> {
  try {
    await api.request(`/api/market/buy-orders/${encodeURIComponent(id)}/cancel`, {
      method: 'POST',
    });
    return { ok: true, message: 'Ordre annulé.' };
  } catch (error) {
    if (error instanceof AuthError || error instanceof PassRequiredError) throw error;
    if (error instanceof ApiError) {
      return {
        ok: false,
        message: error.message || `Kyara a refusé l’annulation (HTTP ${error.status}).`,
      };
    }
    throw error;
  }
}
