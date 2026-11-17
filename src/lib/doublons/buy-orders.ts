import { storage } from 'wxt/utils/storage';
import { ApiError, AuthError, PassRequiredError, type ApiClient } from '../api';
import { buyPlanItem, dayStart, normalizeBuyPlan, type BuyPlan } from './buy-plan';

/**
 * Ordres d'achat préparés : la carte, le prix et la quantité sont saisis dans le panneau,
 * vérifiés contre les plafonds (par ordre et par jour) puis envoyés seulement après deux
 * vrais clics. Une réussite est mémorisée pour que le plafond du jour compte les ordres
 * réellement passés, pas les intentions.
 */

export type Api = Pick<ApiClient, 'request'>;

/** Quantité maximale d'un ordre : borne l'erreur de saisie. */
export const BUY_ORDER_QTY_MAX = 20;

export interface BuyOrderDraft {
  characterId: number;
  name: string | null;
  price: number;
  qty: number;
}

export interface BuyOrderEntry extends BuyOrderDraft {
  /** Identifiant de l'ordre renvoyé par Kyara, vide si absent. */
  id: string;
  at: number;
}

export interface BuyOrders {
  entries: BuyOrderEntry[];
}

/** Ordres conservés : au-delà, les plus anciens sortent. */
export const BUY_ORDER_MAX = 200;

export const buyOrdersItem = storage.defineItem<BuyOrders>('local:buyOrders', {
  fallback: { entries: [] },
  version: 1,
});

export function normalizeBuyOrders(raw: unknown): BuyOrders {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const rows = Array.isArray(source.entries) ? source.entries : [];
  const entries: BuyOrderEntry[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const entry = row as Record<string, unknown>;
    const price = Number(entry.price);
    const qty = Number(entry.qty);
    if (!Number.isSafeInteger(Number(entry.characterId)) || Number(entry.characterId) <= 0) continue;
    if (!Number.isFinite(price) || price <= 0) continue;
    if (!Number.isSafeInteger(qty) || qty < 1) continue;
    entries.push({
      id: typeof entry.id === 'string' ? entry.id : String(entry.id ?? ''),
      characterId: Number(entry.characterId),
      name: typeof entry.name === 'string' ? entry.name : null,
      price,
      qty,
      at: Number(entry.at) > 0 ? Number(entry.at) : 0,
    });
  }
  return { entries: entries.slice(-BUY_ORDER_MAX) };
}

/** Ce qui empêche un brouillon d'être envoyé, ou `null` s'il est valide. */
export function draftProblem(draft: BuyOrderDraft): string | null {
  if (!Number.isSafeInteger(draft.characterId) || draft.characterId <= 0) {
    return 'Choisis une carte du catalogue.';
  }
  if (!Number.isSafeInteger(draft.price) || draft.price <= 0) {
    return 'Le prix doit être un entier positif.';
  }
  if (!Number.isSafeInteger(draft.qty) || draft.qty < 1 || draft.qty > BUY_ORDER_QTY_MAX) {
    return `La quantité doit être un entier entre 1 et ${BUY_ORDER_QTY_MAX}.`;
  }
  return null;
}

/** Somme des ordres envoyés aujourd'hui (prix × quantité). */
export function ordersSpentToday(entries: readonly BuyOrderEntry[], now = Date.now()): number {
  const start = dayStart(now);
  return entries
    .filter((entry) => entry.at >= start)
    .reduce((total, entry) => total + entry.price * entry.qty, 0);
}

export interface OrderCheck {
  ok: boolean;
  /** Message prêt à afficher : refus chiffré ou ordre prêt. */
  message: string;
  /** Coût de l'ordre (prix × quantité). */
  total: number;
  /** Déjà engagé aujourd'hui avant cet ordre. */
  spent: number;
  /** Reste disponible sur le plafond journalier. */
  remaining: number;
}

/** Vérifie les deux plafonds avant tout envoi. */
export function checkOrder(
  draft: BuyOrderDraft,
  plan: BuyPlan,
  entries: readonly BuyOrderEntry[],
  now = Date.now(),
): OrderCheck {
  const spent = ordersSpentToday(entries, now);
  const remaining = Math.max(0, plan.maxPerDay - spent);
  const price = Number.isSafeInteger(draft.price) && draft.price > 0 ? draft.price : 0;
  const qty = Number.isSafeInteger(draft.qty) && draft.qty > 0 ? draft.qty : 0;
  const total = price * qty;
  const problem = draftProblem(draft);
  if (problem) return { ok: false, message: problem, total, spent, remaining };
  const name = draft.name ?? `Carte #${draft.characterId}`;
  if (draft.price > plan.maxPerListing) {
    return {
      ok: false,
      message: `Refusé : ${draft.price} ◆ dépasse le plafond par ordre (${plan.maxPerListing} ◆).`,
      total,
      spent,
      remaining,
    };
  }
  if (total > remaining) {
    return {
      ok: false,
      message: `Refusé : ${total} ◆ dépasse les ${remaining} ◆ restants sur le plafond du jour (${plan.maxPerDay} ◆).`,
      total,
      spent,
      remaining,
    };
  }
  return {
    ok: true,
    message: `Ordre prêt : ${name} ×${draft.qty} à ${draft.price} ◆ (${total} ◆), reste ${remaining - total} ◆ aujourd'hui.`,
    total,
    spent,
    remaining,
  };
}

/**
 * Récapitulatif copiable : carte, prix, quantité, coût, plafonds et reste du jour. Aucun
 * envoi n'est déclenché.
 */
export function orderRecap(
  draft: BuyOrderDraft | null,
  plan: BuyPlan,
  entries: readonly BuyOrderEntry[],
  now = Date.now(),
): string {
  const spent = ordersSpentToday(entries, now);
  const start = dayStart(now);
  const done = entries.filter((entry) => entry.at >= start).length;
  const lines = [
    `Ordres d’achat — ${done} envoyé(s) aujourd’hui, ${spent} ◆ engagés`,
    `Plafond par ordre : ${plan.maxPerListing} ◆ · plafond du jour : ${plan.maxPerDay} ◆ · reste ${Math.max(0, plan.maxPerDay - spent)} ◆`,
  ];
  if (!draft) {
    lines.push('- Aucun ordre préparé : choisis une carte, un prix et une quantité.');
  } else {
    const check = checkOrder(draft, plan, entries, now);
    const name = draft.name ?? `Carte #${draft.characterId}`;
    lines.push(`- ${name} ×${draft.qty} à ${draft.price} ◆ = ${check.total} ◆`);
    lines.push(`- ${check.ok ? 'Sous les plafonds.' : check.message}`);
  }
  lines.push('Deux clics sur « Envoyer l’ordre » : rien ne part sans ce geste.');
  return lines.join('\n');
}

export interface PlaceOrderOptions {
  plan?: BuyPlan;
  entries?: readonly BuyOrderEntry[];
  now?: number;
  read?: () => Promise<unknown>;
  write?: (value: BuyOrders) => Promise<void>;
}

export interface PlaceOrderResult {
  ok: boolean;
  message: string;
  /** Exemplaires achetés immédiatement par l'ordre (0 si l'ordre reste ouvert). */
  filled: number;
  entries: BuyOrderEntry[];
}

/**
 * Envoie un ordre après vérification. Un refus des plafonds n'écrit rien et n'appelle pas
 * Kyara ; une réponse d'erreur du site est rendue comme un résultat.
 */
export async function placeBuyOrder(
  api: Api,
  draft: BuyOrderDraft,
  options: PlaceOrderOptions = {},
): Promise<PlaceOrderResult> {
  const now = options.now ?? Date.now();
  const plan =
    options.plan ??
    normalizeBuyPlan(
      await (options.read ?? (() => buyPlanItem.getValue()))().catch(() => null),
    );
  const entries =
    options.entries ??
    normalizeBuyOrders(
      await (options.read ?? (() => buyOrdersItem.getValue()))().catch(() => null),
    ).entries;
  const check = checkOrder(draft, plan, entries, now);
  if (!check.ok) return { ok: false, message: check.message, filled: 0, entries: [...entries] };
  try {
    const data = await api.request<unknown>('/api/market/buy-orders', {
      method: 'POST',
      body: { characterId: draft.characterId, price: draft.price, qty: draft.qty },
    });
    const record =
      data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
    const order =
      record.order && typeof record.order === 'object'
        ? (record.order as Record<string, unknown>)
        : {};
    const filled = Number(order.filled) > 0 ? Number(order.filled) : 0;
    const entries2 = [
      { ...draft, id: String(order.id ?? ''), at: now },
      ...entries,
    ].slice(0, BUY_ORDER_MAX);
    await (options.write ?? ((value: BuyOrders) => buyOrdersItem.setValue(value)))({
      entries: entries2,
    });
    const name = draft.name ?? `Carte #${draft.characterId}`;
    return {
      ok: true,
      message:
        filled > 0
          ? `${name} achetée tout de suite pour ${check.total} ◆.`
          : `Ordre placé : ${name} ×${draft.qty} à ${draft.price} ◆ (${check.total} ◆).`,
      filled,
      entries: entries2,
    };
  } catch (error) {
    if (error instanceof AuthError || error instanceof PassRequiredError) throw error;
    if (error instanceof ApiError) {
      return {
        ok: false,
        message: error.message || `Kyara a refusé l’ordre (HTTP ${error.status}).`,
        filled: 0,
        entries: [...entries],
      };
    }
    throw error;
  }
}

export interface BatchOrderOptions extends PlaceOrderOptions {
  /** Pause entre deux ordres, en ms. */
  gapMs?: number;
  /** Attente injectable pour les tests. */
  wait?: (ms: number) => Promise<void>;
  /** Appelé après chaque envoi réussi. */
  onPlaced?: (placed: number, total: number) => void;
}

export interface BatchOrderResult {
  placed: number;
  filled: number;
  total: number;
  entries: BuyOrderEntry[];
  /** Message du premier refus, `null` si toute la file est passée. */
  stop: string | null;
}

/**
 * Achat groupé plafonné : envoie des ordres préparés l'un après l'autre, avec une pause
 * entre deux, un plafond partagé (chaque ordre consomme le reste du jour) et un arrêt au
 * premier refus. Aucun ordre n'est envoyé sans appel explicite de cette fonction.
 */
export async function placeBuyOrders(
  api: Api,
  drafts: readonly BuyOrderDraft[],
  options: BatchOrderOptions = {},
): Promise<BatchOrderResult> {
  const wait =
    options.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const gap = options.gapMs ?? 600;
  let entries = [
    ...(options.entries ??
      normalizeBuyOrders(
        await (options.read ?? (() => buyOrdersItem.getValue()))().catch(() => null),
      ).entries),
  ];
  let placed = 0;
  let filled = 0;
  let total = 0;
  let stop: string | null = null;
  for (const [index, draft] of drafts.entries()) {
    if (index > 0) await wait(gap);
    const result = await placeBuyOrder(api, draft, {
      plan: options.plan,
      entries,
      now: options.now,
      write: async (value) => {
        entries = value.entries;
        await (options.write ?? ((stored: BuyOrders) => buyOrdersItem.setValue(stored)))(value);
      },
    });
    entries = result.entries;
    if (!result.ok) {
      stop = result.message;
      break;
    }
    placed += 1;
    filled += result.filled;
    total += draft.price * draft.qty;
    options.onPlaced?.(placed, total);
  }
  return { placed, filled, total, entries, stop };
}
