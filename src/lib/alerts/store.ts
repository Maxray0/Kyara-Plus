import { storage } from 'wxt/utils/storage';
import { normalizeAlerts, type Alert } from './model';

/** Alertes locales, jamais persistées hors de `storage.local`. */
export const alertsItem = storage.defineItem<Alert[]>('local:alerts', {
  fallback: [],
  version: 1,
});

const same = (left: readonly Alert[], right: readonly Alert[]): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

/** Relit et borne les alertes sans écriture. */
export async function loadAlerts(now = Date.now()): Promise<Alert[]> {
  try {
    return normalizeAlerts(await alertsItem.getValue(), now);
  } catch {
    return [];
  }
}

/**
 * Ajoute ou met à jour des alertes par clé, puis élague les anciennes.
 * Un stockage en échec ne propage jamais l'erreur aux sources.
 */
export async function upsertAlerts(incoming: readonly Alert[], now = Date.now()): Promise<Alert[]> {
  try {
    const stored = await alertsItem.getValue();
    const existing = normalizeAlerts(stored, now);
    const next = normalizeAlerts([...existing, ...incoming], now);
    // Même sans nouvelle alerte, un stockage déjà trop long doit être réécrit élagué.
    const pruned = JSON.stringify(stored) !== JSON.stringify(existing);
    if (pruned || !same(existing, next)) await alertsItem.setValue(next);
    return next;
  } catch {
    return [];
  }
}

/** Marque une alerte comme lue ou non lue ; une clé absente ne crée rien. */
export async function markAlertRead(key: string, read = true, now = Date.now()): Promise<Alert[]> {
  try {
    const stored = await alertsItem.getValue();
    const existing = normalizeAlerts(stored, now);
    const next = existing.map((alert) =>
      alert.key === key && alert.read !== read ? { ...alert, read } : alert,
    );
    const pruned = JSON.stringify(stored) !== JSON.stringify(existing);
    if (pruned || !same(existing, next)) await alertsItem.setValue(next);
    return next;
  } catch {
    return [];
  }
}

/** Marque toutes les alertes visibles comme lues. */
export async function markAllAlertsRead(now = Date.now()): Promise<Alert[]> {
  try {
    const stored = await alertsItem.getValue();
    const existing = normalizeAlerts(stored, now);
    const next = existing.map((alert) => (alert.read ? alert : { ...alert, read: true }));
    const pruned = JSON.stringify(stored) !== JSON.stringify(existing);
    if (pruned || !same(existing, next)) await alertsItem.setValue(next);
    return next;
  } catch {
    return [];
  }
}

/** Efface le stockage local des alertes. */
export async function clearAlerts(): Promise<void> {
  try {
    await alertsItem.setValue([]);
  } catch {
    // Une alerte ne doit jamais bloquer l'action qui la nettoie.
  }
}
