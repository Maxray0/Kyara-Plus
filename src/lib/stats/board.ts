import { AuthError, type ApiClient } from '../api';
import {
  STAT_MAX_ACCOUNTS,
  accountMetrics,
  collectionValue,
  emptyAccount,
  ownerCounts,
  record,
  unionIds,
  type Account,
  type CatalogCard,
  type StatData,
} from './model';
import {
  fetchFairPrices,
  fetchOwnedIds,
  fetchOwnQuantities,
  fetchProfile,
  fetchSiteRank,
  type PlayerHit,
} from './remote';

type Api = Pick<ApiClient, 'request'>;

/** Le compte connecté est toujours suivi. Renvoie les données mises à jour. */
export function ensureSelf(
  data: StatData,
  user: { id: string; pseudo?: string | null; avatar?: string | null },
  now: number,
): StatData {
  const existing = data.accounts[user.id];
  const entry = existing ?? emptyAccount(user.id, user.pseudo ?? 'Moi', 'self', now);
  return {
    ...data,
    accounts: {
      ...data.accounts,
      [user.id]: {
        ...entry,
        self: true,
        source: 'self',
        pseudo: user.pseudo ?? entry.pseudo,
        avatar: user.avatar ?? entry.avatar,
      },
    },
  };
}

export type AddResult = { data: StatData; added: boolean; reason?: 'known' | 'full' };

export function addAccount(
  data: StatData,
  hit: Pick<PlayerHit, 'id' | 'pseudo' | 'avatar' | 'pos'>,
  source: 'friend' | 'manual',
  now: number,
): AddResult {
  if (data.accounts[hit.id]) return { data, added: false, reason: 'known' };
  if (Object.keys(data.accounts).length >= STAT_MAX_ACCOUNTS) {
    return { data, added: false, reason: 'full' };
  }
  const entry: Account = {
    ...emptyAccount(hit.id, hit.pseudo || 'Joueur', source, now),
    avatar: hit.avatar,
    rankPos: hit.pos,
  };
  return { data: { ...data, accounts: { ...data.accounts, [hit.id]: entry } }, added: true };
}

/** Le compte connecté ne peut pas être retiré. */
export function removeAccount(data: StatData, id: string): StatData {
  const entry = data.accounts[id];
  if (!entry || entry.self) return data;
  const accounts = { ...data.accounts };
  delete accounts[id];
  return { ...data, accounts };
}

/** Importe les amis dans les places restantes ; moi et les ajouts manuels restent prioritaires. */
export function importFriends(data: StatData, friends: readonly PlayerHit[], now: number) {
  let next: StatData = { ...data, friendsAt: now, friendIds: friends.map((f) => f.id) };
  let imported = 0;
  let ignored = 0;
  for (const friend of friends) {
    const result = addAccount(next, friend, 'friend', now);
    next = result.data;
    if (result.added) imported += 1;
    else ignored += 1;
  }
  return { data: next, imported, ignored };
}

export interface SyncDeps {
  api: Api;
  catalog: readonly CatalogCard[];
  now: () => number;
  onProgress?: (message: string, done: number, total: number) => void;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : 'erreur inconnue';
}

/**
 * Lecture complète : profils publics, cartes possédées, rang global, puis valorisation avec les
 * prix officiels demandés une seule fois. `only` limite la lecture à certains comptes ; l'index
 * des propriétaires n'est alors pas recalculé (il demande toutes les collections).
 * Une session expirée interrompt tout ; toute autre erreur reste attachée au compte concerné.
 */
export async function syncAccounts(
  input: StatData,
  deps: SyncDeps,
  signal: AbortSignal,
  only?: readonly string[],
): Promise<StatData> {
  const ids = only ?? Object.keys(input.accounts);
  const accounts: Record<string, Account> = { ...input.accounts };
  const collections: Record<string, string[] | null> = {};
  const full = !only || only.length === Object.keys(input.accounts).length;

  let done = 0;
  for (const id of ids) {
    if (signal.aborted) return input;
    const current = accounts[id];
    if (!current) continue;
    deps.onProgress?.(`Profil de ${current.pseudo}…`, done, ids.length);

    const owned = await fetchOwnedIds(deps.api, id);
    collections[id] = owned;
    const entry: Account = { ...current };
    try {
      const profile = await fetchProfile(deps.api, id);
      if (!profile) throw new Error('profil vide');
      entry.pseudo = String(profile.pseudo ?? profile.name ?? entry.pseudo);
      entry.avatar = typeof profile.avatar === 'string' ? profile.avatar : entry.avatar;
      Object.assign(entry, accountMetrics(profile, owned, null, deps.catalog));
      entry.error = null;
      if (owned) entry.collectionAt = deps.now();
    } catch (error) {
      if (error instanceof AuthError) throw error;
      entry.error = describe(error);
    }
    entry.at = deps.now();
    // Le rang est indépendant du profil : il reste lisible même si /api/users échoue.
    const rank = await fetchSiteRank(deps.api, entry);
    if (rank !== null) entry.rankPos = rank;
    accounts[id] = entry;
    done += 1;
  }
  if (signal.aborted) return input;

  const union = unionIds(Object.values(collections));
  let prices = new Map<string, number>();
  if (union.size) {
    deps.onProgress?.('Prix officiels…', 0, union.size);
    prices = await fetchFairPrices(deps.api, [...union], (d, t) =>
      deps.onProgress?.('Prix officiels…', d, t),
    );
  }
  if (signal.aborted) return input;

  const quantities = ids.some((id) => accounts[id]?.self)
    ? await fetchOwnQuantities(deps.api)
    : null;
  for (const id of ids) {
    const entry = accounts[id];
    const owned = collections[id];
    if (!entry || entry.error || !owned) continue;
    const valued = collectionValue(owned, prices);
    entry.value = valued.value;
    entry.valuePriced = valued.priced;
    entry.valueUnpriced = valued.unpriced;
    entry.valueAt = deps.now();
    // Doublons valorisables seulement pour le compte connecté : le site ne publie pas les autres.
    if (entry.self && quantities) {
      let total = 0;
      for (const [cardId, qty] of quantities) {
        const price = prices.get(cardId);
        if (qty > 1 && price !== undefined) total += price * (qty - 1);
      }
      entry.dupesValue = total;
    }
  }

  const next: StatData = { ...input, accounts, at: deps.now() };
  if (full) {
    next.owners = ownerCounts(collections);
    next.ownerTotal = Object.values(collections).filter((list) => Array.isArray(list)).length;
  }
  return next;
}

export interface ProfileValue {
  /** Valeur exacte seulement quand la liste des cartes est lisible. */
  exact: boolean;
  total: number;
  priced: number;
  unknown: number;
  uniques: number | null;
  byRarity: Record<string, number>;
  rarityValue: Record<string, number>;
  best: { id: string; name: string; rarity: string; price: number | null }[];
  private: boolean;
}

export interface ProfileView {
  user: Record<string, unknown> | null;
  value: ProfileValue;
}

/**
 * Profil d'un autre joueur : informations publiques, valeur de la collection si la liste est
 * lisible, meilleures cartes avec leur prix. Sans liste de cartes, aucune estimation n'est faite.
 */
export async function loadProfile(
  api: Api,
  id: string,
  catalog: readonly CatalogCard[],
  onProgress?: (done: number, total: number) => void,
): Promise<ProfileView> {
  let user: Record<string, unknown> | null = null;
  try {
    user = await fetchProfile(api, id);
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status !== 400 && status !== 404) throw error;
  }

  const best = (Array.isArray(user?.best) ? (user?.best as unknown[]) : []).slice(0, 8).map(record);
  const owned = await fetchOwnedIds(api, id);
  const wanted = [...new Set([...(owned ?? []), ...best.map((c) => String(c.id))])];
  const prices = wanted.length ? await fetchFairPrices(api, wanted, onProgress) : new Map();

  const rarityById = new Map(catalog.map((card) => [card.id, card.rarity]));
  const byRarity: Record<string, number> = {};
  const rarityValue: Record<string, number> = {};
  let total = 0;
  let priced = 0;
  let unknown = 0;
  for (const cardId of owned ?? []) {
    const rarity = rarityById.get(cardId) ?? '';
    if (rarity) byRarity[rarity] = (byRarity[rarity] ?? 0) + 1;
    const price = prices.get(cardId);
    if (price === undefined || price <= 0) {
      unknown += 1;
      continue;
    }
    total += price;
    priced += 1;
    if (rarity) rarityValue[rarity] = (rarityValue[rarity] ?? 0) + price;
  }

  const locked = Array.isArray(user?.locked) ? (user?.locked as unknown[]) : [];
  return {
    user,
    value: {
      exact: owned !== null,
      total,
      priced,
      unknown,
      uniques: owned ? owned.length : null,
      byRarity,
      rarityValue,
      best: best.map((card) => ({
        id: String(card.id),
        name: String(card.name ?? `Carte #${card.id}`),
        rarity: String(card.rarity ?? '').toUpperCase(),
        price: prices.get(String(card.id)) ?? null,
      })),
      private: locked.includes('collection'),
    },
  };
}
