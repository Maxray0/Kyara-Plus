import { storage } from 'wxt/utils/storage';

/**
 * Plafonds de l'achat : ce qui borne un ordre d'achat préparé dans le panneau. Les ordres
 * eux-mêmes vivent dans `buy-orders.ts` ; ce module ne contient plus d'intentions.
 */

export interface BuyPlan {
  /** Plafond pour un ordre, en ◆. */
  maxPerListing: number;
  /** Plafond sur la journée locale, en ◆. */
  maxPerDay: number;
}

export const BUY_PLAN_DEFAULTS: Readonly<BuyPlan> = { maxPerListing: 500, maxPerDay: 2_000 };

export const buyPlanItem = storage.defineItem<BuyPlan>('local:buyPlan', {
  fallback: { ...BUY_PLAN_DEFAULTS },
  version: 1,
});

const clamp = (value: unknown, min: number, max: number, fallback: number): number => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : fallback;
};

export function normalizeBuyPlan(raw: unknown): BuyPlan {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    maxPerListing: clamp(source.maxPerListing, 1, 1_000_000, BUY_PLAN_DEFAULTS.maxPerListing),
    maxPerDay: clamp(source.maxPerDay, 1, 10_000_000, BUY_PLAN_DEFAULTS.maxPerDay),
  };
}

/** Début de la journée locale, pour un plafond qui repart à minuit. */
export function dayStart(now = Date.now()): number {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}
