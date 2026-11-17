import { AuthError, type ApiClient } from '../api';
import { num, record, type CatalogCard } from './model';

type Api = Pick<ApiClient, 'request'>;

export interface PlayerHit {
  id: string;
  pseudo: string;
  avatar: string | null;
  rank: string | null;
  owned: number | null;
  mythics: number | null;
  points: number | null;
  pos: number | null;
  status: string | null;
}

const FAIR_CHUNK = 200;

/** Les erreurs de session remontent ; les autres sont tolérées (donnée simplement absente). */
async function tolerate<T>(task: () => Promise<T>): Promise<T | null> {
  try {
    return await task();
  } catch (error) {
    if (error instanceof AuthError) throw error;
    return null;
  }
}

function listOf(payload: unknown, keys: string[]): unknown[] {
  if (Array.isArray(payload)) return payload;
  const source = record(payload);
  for (const key of keys) {
    const value = source[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}

export function normalizeCatalog(payload: unknown): CatalogCard[] {
  const cards: CatalogCard[] = [];
  const seen = new Set<string>();
  for (const raw of listOf(payload, ['characters', 'items', 'results'])) {
    const card = record(raw);
    const id = card.id ?? card.characterId;
    if (id === undefined || id === null || id === '') continue;
    const key = String(id);
    if (seen.has(key)) continue;
    seen.add(key);
    cards.push({
      id: key,
      series: String(card.series ?? ''),
      rarity: String(card.rarity ?? '')
        .trim()
        .toUpperCase(),
      name: typeof card.name === 'string' ? card.name : undefined,
      image: typeof card.image === 'string' ? card.image : undefined,
    });
  }
  return cards;
}

export async function fetchCatalog(api: Api): Promise<CatalogCard[]> {
  return normalizeCatalog(await api.request('/api/characters', { timeoutMs: 45_000 }));
}

/** Cartes réellement possédées par un joueur (endpoint public d'échange), sans doublons. */
export async function fetchOwnedIds(api: Api, id: string): Promise<string[] | null> {
  const data = await tolerate(() =>
    api.request<unknown>(`/api/trades/owned/${encodeURIComponent(id)}`, { timeoutMs: 25_000 }),
  );
  if (!data) return null;
  const list = Array.isArray(data)
    ? data
    : Array.isArray(record(data).ids)
      ? (record(data).ids as unknown[])
      : Array.isArray(record(data).cards)
        ? (record(data).cards as unknown[])
        : null;
  if (!list) return null;
  const ids: string[] = [];
  for (const entry of list) {
    const value =
      entry && typeof entry === 'object'
        ? (record(entry).characterId ?? record(entry).id ?? record(entry).cardId)
        : entry;
    if (value !== undefined && value !== null) ids.push(String(value));
  }
  return ids.length ? [...new Set(ids)] : null;
}

function priceOf(raw: unknown): number | null {
  return num(raw && typeof raw === 'object' ? (record(raw).price ?? record(raw).value) : raw);
}

/** Prix officiels « fair-play » par lots de 200, comme le site. */
export async function fetchFairPrices(
  api: Api,
  ids: readonly string[],
  onProgress?: (done: number, total: number) => void,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  let done = 0;
  for (let i = 0; i < ids.length; i += FAIR_CHUNK) {
    const chunk = ids.slice(i, i + FAIR_CHUNK);
    const data = await tolerate(() =>
      api.request<unknown>(`/api/fair-play/prices?ids=${chunk.join(',')}`, { timeoutMs: 25_000 }),
    );
    if (Array.isArray(data)) {
      chunk.forEach((id, index) => {
        const value = priceOf(data[index]);
        if (value !== null) out.set(id, value);
      });
    } else if (data && typeof data === 'object') {
      for (const [key, raw] of Object.entries(data)) {
        const value = priceOf(raw);
        if (value !== null) out.set(String(key), value);
      }
    }
    done += chunk.length;
    onProgress?.(done, ids.length);
  }
  return out;
}

export function normalizeHit(raw: unknown): PlayerHit {
  const outer = record(raw);
  const user = record(outer.user ?? outer.player ?? raw);
  const rank = record(user.rank);
  return {
    id: String(user.id ?? outer.id ?? ''),
    pseudo: String(user.pseudo ?? user.name ?? '?'),
    avatar:
      typeof (user.avatar ?? user.avatarUrl) === 'string'
        ? String(user.avatar ?? user.avatarUrl)
        : null,
    rank: typeof rank.label === 'string' ? rank.label : null,
    owned: num(user.owned ?? user.collectionSize ?? user.cards),
    mythics: num(user.mythics),
    points: num(user.points),
    pos: num(user.pos ?? user.position),
    status: typeof outer.status === 'string' ? outer.status : null,
  };
}

const HIT_KEYS = ['users', 'items', 'found', 'results'];

/** Recherche par pseudo, via l'endpoint que le site utilise lui-même. */
export async function searchPlayers(api: Api, query: string): Promise<PlayerHit[]> {
  const data = await api.request<unknown>(`/api/me/friends/search?q=${encodeURIComponent(query)}`, {
    timeoutMs: 20_000,
  });
  return listOf(data, HIT_KEYS)
    .map(normalizeHit)
    .filter((hit) => hit.id);
}

/** Repli : classement par collection, qui ne renvoie que les plus grosses collections. */
export async function searchLadder(api: Api, query: string): Promise<PlayerHit[]> {
  const data = await api.request<unknown>(
    `/api/leaderboard/ladder?by=collection&q=${encodeURIComponent(query)}`,
    { timeoutMs: 20_000 },
  );
  return listOf(record(data).found, [])
    .map(normalizeHit)
    .filter((hit) => hit.id);
}

export async function fetchFriendList(api: Api): Promise<PlayerHit[]> {
  const payload = await api.request<unknown>('/api/me/friends', { timeoutMs: 20_000 });
  const seen = new Set<string>();
  const friends: PlayerHit[] = [];
  for (const raw of listOf(payload, ['friends', ...HIT_KEYS])) {
    const hit = normalizeHit(raw);
    if (!hit.id || seen.has(hit.id)) continue;
    seen.add(hit.id);
    friends.push(hit);
  }
  return friends;
}

/** Rang global d'un compte dans le classement collection (le serveur répond même hors top 100). */
export async function fetchSiteRank(
  api: Api,
  account: { id: string; pseudo: string },
): Promise<number | null> {
  const pseudo = account.pseudo.trim();
  if (!pseudo) return null;
  const payload = await tolerate(() =>
    api.request<unknown>(`/api/leaderboard/ladder?by=collection&q=${encodeURIComponent(pseudo)}`, {
      timeoutMs: 20_000,
    }),
  );
  if (!payload) return null;
  const source = record(payload);
  const list = [source.found, source.rows, source.results, source.users].find(Array.isArray) as
    unknown[] | undefined;
  const rows = (list ?? []).map(record);
  const idOf = (row: Record<string, unknown>) =>
    row.id ?? row.userId ?? record(row.user).id ?? record(row.player).id ?? null;
  const nameOf = (row: Record<string, unknown>) =>
    row.pseudo ?? row.name ?? record(row.user).pseudo ?? record(row.player).pseudo ?? '';
  const hit =
    rows.find((row) => idOf(row) !== null && String(idOf(row)) === account.id) ??
    rows.find((row) => String(nameOf(row)).toLowerCase() === pseudo.toLowerCase());
  if (!hit) return null;
  return num(
    hit.pos ?? hit.position ?? hit.rankPos ?? record(hit.user).pos ?? record(hit.player).pos,
  );
}

export async function fetchProfile(api: Api, id: string): Promise<Record<string, unknown> | null> {
  const user = await api.request<unknown>(`/api/users/${encodeURIComponent(id)}`, {
    timeoutMs: 20_000,
  });
  return user && typeof user === 'object' ? record(user) : null;
}

/** Quantités du compte connecté, pour valoriser ses doublons. */
export async function fetchOwnQuantities(api: Api): Promise<Map<string, number>> {
  const data = await tolerate(() =>
    api.request<unknown>('/api/me/collection?lean=1', { timeoutMs: 25_000 }),
  );
  const out = new Map<string, number>();
  for (const raw of Array.isArray(data) ? data : []) {
    const row = record(raw);
    const id = row.characterId ?? row.id;
    if (id === undefined || id === null) continue;
    const qty = row.qty === undefined ? 1 : Number(row.qty);
    out.set(String(id), Math.max(0, Math.floor(Number.isFinite(qty) ? qty : 1)));
  }
  return out;
}
