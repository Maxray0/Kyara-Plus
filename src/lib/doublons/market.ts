import { storage } from 'wxt/utils/storage';
import { ApiError, AuthError, PassRequiredError, type ApiClient } from '../api';
import { invalidateOwnedCache } from './owned-cache';
import type { PriceData } from './pricing';
import { recordSales } from './sales';

export type Api = Pick<ApiClient, 'request'>;

export interface CallResult {
  ok: boolean;
  status: number;
  data: unknown;
  /** Message d'erreur lisible, vide si la requête a réussi. */
  message: string;
  code: string | null;
}

/**
 * Appel dont l'échec est un résultat, pas une exception, sauf session expirée et vérification
 * anti-robot : celles-ci interrompent toujours l'opération en cours.
 */
export async function call(
  api: Api,
  path: string,
  options: { method?: 'GET' | 'POST' | 'PUT' | 'DELETE'; body?: unknown } = {},
): Promise<CallResult> {
  try {
    const data = await api.request<unknown>(path, options);
    return { ok: true, status: 200, data, message: '', code: null };
  } catch (error) {
    if (error instanceof AuthError || error instanceof PassRequiredError) throw error;
    if (error instanceof ApiError) {
      return {
        ok: false,
        status: error.status,
        data: error.data,
        message: error.message,
        code: error.code,
      };
    }
    throw error;
  }
}

export const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

export const asArray = (data: unknown): unknown[] =>
  Array.isArray(data)
    ? data
    : ((Object.values(record(data)).find(Array.isArray) as unknown[]) ?? []);

// --- Détecteur de changement de Kyara : une réponse qui n'a plus la forme attendue met les
// ventes en pause, sans enregistrer aucune valeur, seulement les noms de champs.
const SHAPES: Record<string, string> = {
  market: 'tes annonces',
  collection: 'ta collection',
  prices: 'les prix du marché',
  fair: 'les prix habituels',
  wishlist: "ta liste d'envies",
};

export class ShapeError extends Error {
  constructor(readonly shape: string) {
    super(`Kyara a changé le format de ${SHAPES[shape] ?? shape}`);
    this.name = 'ShapeError';
  }
}

export interface ShapeChange {
  at: number;
  label: string;
  detail: string;
}

export const shapeChangesItem = storage.defineItem<Record<string, ShapeChange>>(
  'local:shapeChanges',
  {
    fallback: {},
  },
);

export function describeShape(data: unknown): string {
  if (Array.isArray(data)) {
    const first = data[0];
    const fields =
      first && typeof first === 'object'
        ? ` · champs : ${Object.keys(first).slice(0, 14).join(', ')}`
        : '';
    return `liste de ${data.length}${fields}`;
  }
  if (data && typeof data === 'object') {
    return `objet · champs : ${Object.keys(data).slice(0, 14).join(', ') || 'aucun'}`;
  }
  return data === null ? 'vide' : typeof data;
}

export async function hasShapeChanges(): Promise<boolean> {
  return Object.keys(await shapeChangesItem.getValue()).length > 0;
}

export async function clearShapeChanges(): Promise<void> {
  await shapeChangesItem.setValue({});
}

export async function checkShape(
  name: string,
  ok: boolean,
  data: unknown,
  now = Date.now(),
): Promise<void> {
  const flags = { ...(await shapeChangesItem.getValue()) };
  if (ok) {
    if (flags[name]) {
      delete flags[name];
      await shapeChangesItem.setValue(flags);
    }
    return;
  }
  if (!flags[name]) {
    flags[name] = { at: now, label: SHAPES[name] ?? name, detail: describeShape(data) };
    await shapeChangesItem.setValue(flags);
  }
  throw new ShapeError(name);
}

// --- Prix : mémorisés pour l'affichage et le tri ; avant chaque mise en vente, le prix est rafraîchi.
const KEEP_MS = 7 * 24 * 3600e3;

export interface StoredPrice {
  data: PriceData;
  t: number;
}

export const sellPricesItem = storage.defineItem<Record<string, StoredPrice>>('local:sellPrices', {
  fallback: {},
});

export async function storePrice(id: number, data: PriceData, now = Date.now()): Promise<void> {
  const all = { ...(await sellPricesItem.getValue()) };
  all[String(id)] = { data, t: now };
  for (const [key, value] of Object.entries(all)) if (now - value.t > KEEP_MS) delete all[key];
  await sellPricesItem.setValue(all);
}

export async function fetchPrices(api: Api, id: number): Promise<PriceData> {
  const result = await call(api, `/api/market/prices/${id}`);
  if (!result.ok) throw new Error(result.message);
  const data = record(result.data);
  await checkShape(
    'prices',
    ['median7d', 'median30d', 'lastPrice', 'sales30d'].some((key) => key in data),
    result.data,
  );
  await storePrice(id, data as PriceData);
  return data as PriceData;
}

// --- Prix habituels de Kyara : le marché refuse plus de ~3 fois ce prix. Gardés 24 h.
export const FAIR_MAX_RATIO = 3;
const FAIR_TTL = 24 * 3600e3;
const FAIR_CHUNK = 40;

export const fairPricesItem = storage.defineItem<Record<string, [number, number]>>(
  'local:fairPrices',
  {
    fallback: {},
  },
);

export async function fetchFairPrices(
  api: Api,
  ids: readonly number[],
  options: { fresh?: boolean; now?: number } = {},
): Promise<Map<number, number>> {
  const now = options.now ?? Date.now();
  const out = new Map<number, number>();
  const store = { ...(await fairPricesItem.getValue()) };
  const wanted = new Set(ids.map(Number));
  const todo: number[] = [];
  for (const id of wanted) {
    const entry = store[String(id)];
    if (!options.fresh && entry && now - entry[1] < FAIR_TTL) out.set(id, entry[0]);
    else todo.push(id);
  }
  for (let i = 0; i < todo.length; i += FAIR_CHUNK) {
    const result = await call(
      api,
      `/api/fair-play/prices?ids=${todo.slice(i, i + FAIR_CHUNK).join(',')}`,
    );
    if (!result.ok) break;
    const body = record(result.data);
    const map = record(body.prices ?? result.data);
    await checkShape(
      'fair',
      !!result.data &&
        typeof result.data === 'object' &&
        !Array.isArray(result.data) &&
        Object.entries(map).every(([k, v]) => /^\d+$/.test(k) && typeof v === 'number'),
      result.data,
    );
    for (const [key, value] of Object.entries(map)) {
      const n = Number(
        typeof value === 'object' ? (record(value).price ?? record(value).value) : value,
      );
      if (!(n > 0) || Number.isNaN(Number(key))) continue;
      store[key] = [n, now];
      if (wanted.has(Number(key))) out.set(Number(key), n);
    }
  }
  for (const key of Object.keys(store))
    if (now - (store[key]?.[1] ?? 0) > FAIR_TTL) delete store[key];
  await fairPricesItem.setValue(store);
  return out;
}

// --- Mes annonces et cartes temporairement retenues.
export interface Listing {
  id: string;
  characterId: number;
  name: string | null;
  image: string | null;
  rarity: string | null;
  price: number;
  endsAt: string | null;
  type: string;
  bidCount: number;
  currentBid: number | null;
  createdAt: string | null;
}

export async function getMarket(api: Api, now = Date.now()) {
  const result = await call(api, '/api/me/market');
  if (!result.ok) throw new Error(`Mes annonces : ${result.message}`);
  const data = record(result.data);
  const listings = Array.isArray(data.listings)
    ? (data.listings as Record<string, unknown>[])
    : null;
  await checkShape(
    'market',
    !!listings &&
      listings.every(
        (l) =>
          l &&
          typeof l === 'object' &&
          (record(l.character).id ?? l.characterId) != null &&
          'status' in l &&
          'price' in l,
      ),
    result.data,
  );
  await recordSales(listings ?? [], now);
  const active: Listing[] = (listings ?? [])
    .filter((l) => l.isMine !== false && l.status === 'active')
    .map((l) => {
      const character = record(l.character);
      return {
        id: String(l.id),
        characterId: Number(character.id ?? l.characterId),
        name: (character.name as string) ?? null,
        image: (character.image as string) ?? null,
        rarity: (character.rarity as string) ?? null,
        price: Number(l.price),
        endsAt: (l.endsAt as string) ?? null,
        type: (l.type as string) || 'fixed',
        bidCount: Number(l.bidCount) || 0,
        currentBid: (l.currentBid as number) ?? null,
        createdAt: (l.createdAt as string) ?? null,
      };
    });
  const holds = new Map<number, number>();
  for (const raw of Array.isArray(data.holds) ? data.holds : []) {
    const hold = record(raw);
    if (hold.until && new Date(String(hold.until)).getTime() < now) continue;
    const id = Number(hold.characterId);
    holds.set(id, (holds.get(id) ?? 0) + (Number(hold.qty) || 1));
  }
  return { active, holds };
}

export const cancelListing = (api: Api, id: string) =>
  call(api, `/api/market/listings/${encodeURIComponent(id)}/cancel`, { method: 'POST' });

/**
 * Recyclage carte par carte : POST /api/me/collection/{id}/recycle { qty }.
 * Une réussite périme la possession mémorisée, d'où qu'ait lieu le recyclage.
 */
export async function recycleCard(api: Api, id: number, qty: number): Promise<CallResult> {
  const result = await call(api, `/api/me/collection/${id}/recycle`, {
    method: 'POST',
    body: { qty },
  });
  if (result.ok) await invalidateOwnedCache('recyclage');
  return result;
}
