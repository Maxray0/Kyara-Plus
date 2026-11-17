import { storage } from 'wxt/utils/storage';
import type { ApiClient } from '../api';
import { emitDataChange } from './data-events';

export const WISHLIST_TTL_MS = 2 * 60_000;

export interface WishlistCache {
  at: number;
  ids: number[];
}

/** Petit store injectable, pour tester sans dépendre de l'extension. */
export interface WishlistStore {
  read: () => Promise<WishlistCache>;
  write: (value: WishlistCache) => Promise<void>;
}

export const wishlistItem = storage.defineItem<WishlistCache>('local:wishlist', {
  fallback: { at: 0, ids: [] },
  version: 1,
});

export const wishlistStore: WishlistStore = {
  read: () => wishlistItem.getValue(),
  write: (value) => wishlistItem.setValue(value),
};

function idOf(value: unknown): number | null {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 ? value : null;
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  }
  return null;
}

/**
 * Le site renvoie une liste d'identifiants, parfois enveloppée ou composée d'objets
 * (`{ characterId }`, `{ character: { id } }`). On tolère les formes observées, sans
 * jamais inventer un identifiant.
 */
export function parseWishlist(data: unknown): number[] {
  const out = new Set<number>();
  const walk = (value: unknown, depth: number): void => {
    if (depth > 3 || value === null || value === undefined) return;
    if (Array.isArray(value)) {
      for (const entry of value) {
        const direct = idOf(entry);
        if (direct !== null) {
          out.add(direct);
          continue;
        }
        if (!entry || typeof entry !== 'object') continue;
        const row = entry as Record<string, unknown>;
        const character =
          row.character && typeof row.character === 'object'
            ? (row.character as Record<string, unknown>).id
            : undefined;
        const id = idOf(row.characterId ?? character ?? row.charId ?? row.id);
        if (id !== null) out.add(id);
      }
      return;
    }
    if (typeof value === 'object') {
      for (const child of Object.values(value as Record<string, unknown>)) {
        if (Array.isArray(child) || (child !== null && typeof child === 'object')) walk(child, depth + 1);
      }
    }
  };
  walk(data, 0);
  return [...out];
}

/** Une réponse a la forme d'une liste d'envies si elle contient au moins une liste. */
export function isWishlistShape(data: unknown): boolean {
  return (
    Array.isArray(data) ||
    (!!data &&
      typeof data === 'object' &&
      Object.values(data as Record<string, unknown>).some(Array.isArray))
  );
}

export function normalizeWishlistCache(raw: unknown): WishlistCache {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const at = Number(source.at);
  return {
    at: Number.isFinite(at) && at > 0 ? at : 0,
    ids: Array.isArray(source.ids)
      ? [...new Set(source.ids.map(idOf).filter((id): id is number => id !== null))]
      : [],
  };
}

type Api = Pick<ApiClient, 'request'>;

export async function fetchWishlist(api: Api): Promise<number[]> {
  const data = await api.request<unknown>('/api/me/wishlist');
  if (!isWishlistShape(data)) throw new Error("Format de la liste d'envies inattendu");
  return parseWishlist(data);
}

/** Liste d'envies, servie par le cache tant qu'il a moins de deux minutes. */
export async function loadWishlist(
  api: Api,
  store: WishlistStore = wishlistStore,
  options: { force?: boolean; now?: number } = {},
): Promise<number[]> {
  const cached = normalizeWishlistCache(await store.read());
  const now = options.now ?? Date.now();
  if (!options.force && cached.at > 0 && now - cached.at < WISHLIST_TTL_MS) return cached.ids;
  const ids = await fetchWishlist(api);
  await store.write({ at: now, ids });
  return ids;
}

/** Oublie la liste d'envies en cache : la prochaine lecture relira le site. */
export async function invalidateWishlistCache(
  reason = 'écriture',
  store: WishlistStore = wishlistStore,
): Promise<void> {
  try {
    await store.write({ at: 0, ids: [] });
  } catch {
    // Un stockage en échec ne doit pas bloquer l'écriture de jeu qui a réussi.
  }
  emitDataChange({ wishlist: true, reason });
}

/**
 * Retire une carte de la liste d'envies (`DELETE /api/me/wishlist/{id}`).
 * Le site renvoie normalement la liste complète ; sinon on la filtre localement pour
 * répondre à l'appelant, mais le cache est vidé : la prochaine lecture relit le site.
 */
export async function removeWish(
  api: Api,
  id: number,
  store: WishlistStore = wishlistStore,
): Promise<number[]> {
  if (!Number.isSafeInteger(id) || id < 1) throw new Error('Carte invalide');
  const data = await api.request<unknown>(`/api/me/wishlist/${id}`, { method: 'DELETE' });
  const current = normalizeWishlistCache(await store.read());
  const returned = isWishlistShape(data) ? parseWishlist(data) : [];
  const ids = returned.length ? returned : current.ids.filter((item) => item !== id);
  // Vider le cache, pas seulement émettre : une autre vue ne doit pas relire une liste
  // que cette écriture vient de changer.
  await invalidateWishlistCache('retrait', store);
  return ids;
}

/**
 * Ajoute une carte à la liste d'envies (`PUT /api/me/wishlist/{id}`).
 * Le site renvoie normalement la liste complète ; sinon on complète la liste lue pour
 * répondre à l'appelant, mais le cache est vidé : la prochaine lecture relit le site.
 */
export async function addWish(
  api: Api,
  id: number,
  store: WishlistStore = wishlistStore,
): Promise<number[]> {
  if (!Number.isSafeInteger(id) || id < 1) throw new Error('Carte invalide');
  const data = await api.request<unknown>(`/api/me/wishlist/${id}`, { method: 'PUT' });
  const current = normalizeWishlistCache(await store.read());
  const returned = isWishlistShape(data) ? parseWishlist(data) : [];
  const ids = returned.length ? returned : [...new Set([...current.ids, id])];
  // Vider le cache, pas seulement émettre : une autre vue ne doit pas relire une liste
  // que cette écriture vient de changer.
  await invalidateWishlistCache('ajout', store);
  return ids;
}
