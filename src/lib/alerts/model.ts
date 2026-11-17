/**
 * Modèle commun des alertes locales : wishlist, échanges et veille de cartes.
 * Une alerte n'est jamais une notification système ; elle reste dans l'extension.
 */

export const ALERT_KINDS = ['wishlist', 'trade', 'market', 'order'] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];

/** Nombre maximal d'alertes conservées. */
export const ALERT_MAX = 100;
/** Durée de conservation d'une alerte, en jours. */
export const ALERT_RETENTION_DAYS = 30;

const DAY = 86_400_000;
const MAX_KEY = 160;
const MAX_TITLE = 200;
const MAX_MESSAGE = 500;
const MAX_HREF = 1_000;

export interface Alert {
  /** Clé stable servant aussi à dédupliquer une alerte répétée. */
  key: string;
  kind: AlertKind;
  title: string;
  message: string;
  /** Instant de l'événement, borné à la date de lecture. */
  at: number;
  read: boolean;
  /** Lien HTTPS vers la fiche ou l'échange concerné, jamais une URL arbitraire. */
  href: string | null;
  /** Vrai quand l'alerte concerne une carte de la liste d'envies. */
  wishlist?: boolean;
  /** Carte concernée, pour afficher sa miniature dans la cloche. */
  cardId?: number;
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const text = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';

const isKind = (value: unknown): value is AlertKind => ALERT_KINDS.includes(value as AlertKind);

function safeHref(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const href = value.trim().slice(0, MAX_HREF);
  return /^https:\/\/kyara\.games\//i.test(href) ? href : null;
}

/** Revalide une alerte relue du stockage ; un champ indispensable absent la rejette. */
export function cleanAlert(value: unknown, now = Date.now()): Alert | null {
  const raw = asRecord(value);
  const key = text(raw.key, MAX_KEY);
  const title = text(raw.title, MAX_TITLE);
  const kind = raw.kind;
  const at = Number(raw.at);
  if (!key || !title || !isKind(kind) || !Number.isFinite(at) || at <= 0) return null;
  return {
    key,
    kind,
    title,
    message: text(raw.message, MAX_MESSAGE),
    at: Math.min(at, now),
    read: raw.read === true,
    href: safeHref(raw.href),
    ...(raw.wishlist === true ? { wishlist: true } : {}),
    ...(Number.isSafeInteger(Number(raw.cardId)) && Number(raw.cardId) > 0
      ? { cardId: Number(raw.cardId) }
      : {}),
  };
}

/**
 * Filtre les alertes invalides ou trop anciennes, déduplique par clé en gardant
 * l'occurrence la plus récente et applique le plafond de stockage.
 */
export function normalizeAlerts(raw: unknown, now = Date.now()): Alert[] {
  if (!Array.isArray(raw)) return [];
  const cutoff = now - ALERT_RETENTION_DAYS * DAY;
  const byKey = new Map<string, Alert>();
  for (const value of raw) {
    const alert = cleanAlert(value, now);
    if (!alert || alert.at < cutoff) continue;
    const previous = byKey.get(alert.key);
    if (!previous) {
      byKey.set(alert.key, alert);
      continue;
    }
    const winner = alert.at >= previous.at ? alert : previous;
    // Une alerte déjà lue reste lue quand une occurrence répétée est dédupliquée.
    byKey.set(alert.key, { ...winner, read: winner.read || previous.read || alert.read });
  }
  return [...byKey.values()]
    .sort((a, b) => b.at - a.at || a.key.localeCompare(b.key, 'fr'))
    .slice(0, ALERT_MAX);
}

/** Fusionne un historique et de nouvelles alertes sans doublon. */
export function mergeAlerts(
  existing: readonly Alert[],
  incoming: readonly Alert[],
  now = Date.now(),
): Alert[] {
  return normalizeAlerts([...existing, ...incoming], now);
}

/** Nombre d'alertes non lues, affiché par le compteur de la cloche. */
export function unreadAlertCount(alerts: readonly Alert[]): number {
  return alerts.reduce((count, alert) => count + (alert.read ? 0 : 1), 0);
}
