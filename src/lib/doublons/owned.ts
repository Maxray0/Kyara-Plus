import type { ApiClient } from '../api';
import { emitDataChange } from './data-events';
import { OWNED_TTL_MS, ownedStore, normalizeOwnedCache, type OwnedStore } from './owned-cache';
import { ownedFromCollection } from './trades';

/**
 * Le site refuse de mettre en envie une carte déjà possédée (`409 wish_owned`).
 * Le panneau lit donc la collection avant le clic, et garde la mémoire des refus
 * pour ne plus proposer un ajout voué à l'échec.
 *
 * Le cache et son invalidation vivent dans `owned-cache` : chaque fonction d'écriture
 * (vente, recyclage, épingle, échange) les périme elle-même, donc le panneau comme les
 * pages complètes en profitent.
 */

export {
  OWNED_TTL_MS,
  invalidateOwnedCache,
  normalizeOwnedCache,
  ownedItem,
  ownedStore,
} from './owned-cache';
export type { OwnedCache, OwnedStore } from './owned-cache';

type Api = Pick<ApiClient, 'request'>;

/** Identifiants possédés (au moins une copie), lus dans `/api/me/collection?lean=1`. */
export async function fetchOwnedIds(api: Api): Promise<number[]> {
  const { owned } = ownedFromCollection(await api.request<unknown>('/api/me/collection?lean=1'));
  return [...owned.entries()].filter(([, qty]) => qty > 0).map(([id]) => id);
}

/**
 * Possession connue : le cache tant qu'il a moins de dix minutes, sinon la collection.
 * Une lecture impossible garde le cache plutôt que de casser le panneau.
 */
export async function loadOwnedIds(
  api: Api,
  store: OwnedStore = ownedStore,
  options: { force?: boolean; now?: number } = {},
): Promise<number[]> {
  const cached = normalizeOwnedCache(await store.read());
  const now = options.now ?? Date.now();
  if (!options.force && cached.at > 0 && now - cached.at < OWNED_TTL_MS) return cached.ids;
  try {
    const ids = await fetchOwnedIds(api);
    await store.write({ at: now, ids });
    return ids;
  } catch {
    return cached.ids;
  }
}

/** Retient des cartes que le site vient de refuser : plus de bouton d'ajout. */
export async function rememberOwned(
  ids: readonly number[],
  store: OwnedStore = ownedStore,
  now = Date.now(),
): Promise<void> {
  const valid = ids.filter((id) => Number.isSafeInteger(id) && id > 0);
  if (!valid.length) return;
  const current = normalizeOwnedCache(await store.read());
  await store.write({ at: now, ids: [...new Set([...current.ids, ...valid])] });
}

// Le bus reste réexporté ici : les vues n'ont qu'un module à connaître.
export { emitDataChange };
