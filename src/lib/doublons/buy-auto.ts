import { storage } from 'wxt/utils/storage';

/**
 * Envoi automatique de la file d'ordres préparée : coupé par défaut, jamais plus d'un
 * lot par intervalle et jamais plus de `maxPerHour` ordres sur une heure glissante. Le
 * plafond du jour reste celui de `placeBuyOrders` ; ce module ne lit que du local.
 */

export interface BuyAutoSettings {
  enabled: boolean;
  /** Minutes minimales entre deux envois automatiques. */
  intervalMin: number;
  /** Ordres maximaux envoyés sur une heure glissante. */
  maxPerHour: number;
}

export const BUY_AUTO_DEFAULTS: Readonly<BuyAutoSettings> = {
  enabled: false,
  intervalMin: 15,
  maxPerHour: 2,
};

export const buyAutoSettingsItem = storage.defineItem<BuyAutoSettings>('local:buyAutoSettings', {
  fallback: { ...BUY_AUTO_DEFAULTS },
  version: 1,
});

/** Horodatages des ordres envoyés automatiquement, pour la fenêtre glissante. */
export const buyAutoSentItem = storage.defineItem<{ at: number[] }>('local:buyAutoSent', {
  fallback: { at: [] },
  version: 1,
});

const HOUR = 3_600_000;

const int = (value: unknown, fallback: number): number =>
  Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : fallback;

const bound = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

export function normalizeBuyAutoSettings(raw: unknown): BuyAutoSettings {
  const source =
    raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return {
    enabled: source.enabled === true,
    intervalMin: bound(int(source.intervalMin, BUY_AUTO_DEFAULTS.intervalMin), 5, 720),
    maxPerHour: bound(int(source.maxPerHour, BUY_AUTO_DEFAULTS.maxPerHour), 1, 20),
  };
}

/** Nombre d'ordres déjà envoyés dans l'heure qui précède `now`. */
export function sentInLastHour(sent: readonly number[], now: number): number {
  return sent.filter((at) => Number.isFinite(at) && at <= now && now - at < HOUR).length;
}

export type BuyAutoDecision =
  | { action: 'off' }
  | { action: 'empty' }
  | { action: 'hourly'; nextAt: number }
  | { action: 'wait'; nextAt: number }
  | { action: 'send'; budget: number };

export interface BuyAutoInput {
  settings: BuyAutoSettings;
  /** Horodatages des envois automatiques précédents. */
  sent: readonly number[];
  /** Ordres actuellement dans la file. */
  queueLength: number;
  /** Dernier envoi automatique, 0 s'il n'y en a jamais eu. */
  lastAt: number;
  now: number;
}

/** Décide s'il faut envoyer la file maintenant, attendre, ou ne rien faire. */
export function autoBuyDecision(input: BuyAutoInput): BuyAutoDecision {
  const settings = normalizeBuyAutoSettings(input.settings);
  if (!settings.enabled) return { action: 'off' };
  if (input.queueLength <= 0) return { action: 'empty' };
  const recent = input.sent.filter((at) => at <= input.now && input.now - at < HOUR);
  const budget = settings.maxPerHour - recent.length;
  if (budget <= 0) {
    const oldest = Math.min(...recent);
    return { action: 'hourly', nextAt: oldest + HOUR };
  }
  const due = (input.lastAt || 0) + settings.intervalMin * 60_000;
  if (input.lastAt > 0 && input.now < due) return { action: 'wait', nextAt: due };
  return { action: 'send', budget };
}

/** Garde les horodatages de l'heure écoulée seulement. */
export function pruneSent(sent: readonly number[], now: number): number[] {
  return sent.filter((at) => Number.isFinite(at) && at <= now && now - at < HOUR);
}
