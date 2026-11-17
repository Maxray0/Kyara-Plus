import { storage } from 'wxt/utils/storage';
import { emitDataChange } from './data-events';

/**
 * Cache de possession partagé par le panneau, la page Doublons et la veille de prix.
 * Il vit dans son propre module, sans autre dépendance que le stockage et le bus, pour que
 * chaque fonction d'écriture (vente, recyclage, épingle, échange) puisse l'invalider sans
 * créer de cycle d'imports.
 */

/** Durée de validité de la possession mémorisée, alignée sur la collection. */
export const OWNED_TTL_MS = 10 * 60_000;

export interface OwnedCache {
  at: number;
  ids: number[];
}

/** Petit store injectable, pour tester sans dépendre de l'extension. */
export interface OwnedStore {
  read: () => Promise<OwnedCache>;
  write: (value: OwnedCache) => Promise<void>;
}

export const ownedItem = storage.defineItem<OwnedCache>('local:wish-owned', {
  fallback: { at: 0, ids: [] },
  version: 1,
});

export const ownedStore: OwnedStore = {
  read: () => ownedItem.getValue(),
  write: (value) => ownedItem.setValue(value),
};

export function normalizeOwnedCache(raw: unknown): OwnedCache {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const at = Number(source.at);
  const ids = Array.isArray(source.ids)
    ? source.ids
        .map((value) => Number(value))
        .filter((value) => Number.isSafeInteger(value) && value > 0)
    : [];
  return { at: Number.isFinite(at) && at > 0 ? at : 0, ids: [...new Set(ids)] };
}

/** Oublie la possession mémorisée : la prochaine lecture relira la collection. */
export async function invalidateOwnedCache(
  reason = 'écriture',
  store: OwnedStore = ownedStore,
): Promise<void> {
  try {
    await store.write({ at: 0, ids: [] });
  } catch {
    // Un stockage en échec ne doit pas bloquer l'écriture de jeu qui a réussi.
  }
  emitDataChange({ owned: true, reason });
}
