export const ORIGIN = 'https://kyara.games';
export const CACHE_TTL = 5 * 60 * 1000;
export const EMPTY_TTL = 60 * 1000;
export const ERROR_TTL = 60 * 1000;
export const MAX_CACHE_ENTRIES = 1000;
export const RECENT_TTL = 60 * 60 * 1000;

const numberFormat = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });
export const formatPrice = (value: number) => numberFormat.format(value);

export type QuoteStatus = 'ok' | 'empty' | 'error';

export interface Quote {
  status: QuoteStatus;
  value: number | null;
  /** 7 ou 30 jours ; null pour la médiane des 10 dernières ventes. */
  period: 7 | 30 | null;
  median7d?: number | null;
  median30d?: number | null;
  sales7d?: number;
  sales30d?: number;
  basis?: 'last10';
  sampleSize?: number;
  name?: string;
  series?: string | null;
  rarity?: string;
  message?: string;
  fetchedAt: number;
  expiresAt: number;
}

type Raw = Record<string, unknown>;
const isRecord = (value: unknown): value is Raw =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const unexpected = (what: string) => new Error(`Réponse de ${what} inattendue`);

/** Identifiant de carte d'un lien `/wiki/{id}` du site. */
export function characterId(href: string | null): number | null {
  if (!href) return null;
  try {
    const url = new URL(href, ORIGIN);
    if (url.origin !== ORIGIN) return null;
    const match = /^\/wiki\/([1-9]\d*)\/?$/.exec(url.pathname);
    const id = match ? Number(match[1]) : NaN;
    return Number.isSafeInteger(id) ? id : null;
  } catch {
    return null;
  }
}

export function isOffersPage(href: string): boolean {
  try {
    const url = new URL(href);
    return (
      url.origin === ORIGIN &&
      /^\/marche\/?$/.test(url.pathname) &&
      url.searchParams.get('onglet') === 'offres'
    );
  } catch {
    return false;
  }
}

/** Identifiant d'une image de carte du site, ou de l'image AniList de repli. */
export function cardImageId(src: string | null): number | null {
  if (!src) return null;
  try {
    const url = new URL(src, ORIGIN);
    let match: RegExpExecArray | null = null;
    if (url.origin === ORIGIN) {
      match = /^\/cards\/(?:sm|lg)\/([1-9]\d*)\.webp$/.exec(url.pathname);
    } else if (url.protocol === 'https:' && /^s\d+\.anilist\.co$/.test(url.hostname)) {
      match =
        /^\/file\/anilistcdn\/character\/(?:large|medium|small)\/b?([1-9]\d*)(?:-[^/]+)?\.(?:png|jpe?g|webp)$/.exec(
          url.pathname,
        );
    }
    const id = match ? Number(match[1]) : NaN;
    return Number.isSafeInteger(id) ? id : null;
  } catch {
    return null;
  }
}

function validMedian(data: Raw, field: string): boolean {
  if (!(field in data)) return false;
  const value = data[field];
  return value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0);
}

/** Refuse un changement de schéma de l'API plutôt que d'afficher une valeur inventée. */
export function normalizePrices(data: unknown, id: number): Quote {
  if (!isRecord(data) || data.characterId !== id) throw unexpected('prix');
  if (!validMedian(data, 'median7d') || !validMedian(data, 'median30d')) throw unexpected('prix');
  const median7d = data.median7d as number | null;
  const median30d = data.median30d as number | null;
  const period = median7d !== null ? 7 : median30d !== null ? 30 : null;
  const quote: Quote = {
    status: period === null ? 'empty' : 'ok',
    value: period === 7 ? median7d : period === 30 ? median30d : null,
    period,
    median7d,
    median30d,
    fetchedAt: 0,
    expiresAt: 0,
  };
  for (const field of ['sales7d', 'sales30d'] as const) {
    const value = data[field];
    if (Number.isSafeInteger(value) && (value as number) >= 0) quote[field] = value as number;
  }
  return quote;
}

export function retryDelay(value: string | null, now: number): number {
  if (!value) return ERROR_TTL;
  const seconds = Number(value);
  const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now;
  return Number.isFinite(delay) ? Math.max(ERROR_TTL, delay) : ERROR_TTL;
}

/** Médiane des 10 dernières ventes (Légendaires et Mythiques, dont les ventes sont rares). */
export function recentPrices(data: unknown, id: number): Quote {
  const official = normalizePrices(data, id);
  const sales = (data as Raw).lastSales;
  if (!Array.isArray(sales)) throw new Error('Historique des ventes indisponible');
  const values = sales
    .filter(
      (sale): sale is { price: number; at: string } =>
        isRecord(sale) &&
        typeof sale.price === 'number' &&
        Number.isFinite(sale.price) &&
        sale.price >= 0 &&
        typeof sale.at === 'string' &&
        Number.isFinite(Date.parse(sale.at)),
    )
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, 10)
    .map((sale) => sale.price)
    .sort((a, b) => a - b);
  const n = values.length;
  const value = n
    ? ((values[Math.floor((n - 1) / 2)] ?? 0) + (values[Math.floor(n / 2)] ?? 0)) / 2
    : null;
  return {
    ...official,
    status: n ? 'ok' : 'empty',
    value,
    period: null,
    basis: 'last10',
    sampleSize: n,
  };
}

export interface CharacterInfo {
  name: string;
  series: string | null;
  rarity?: string;
}

export function normalizeCharacter(data: unknown, id: number): CharacterInfo {
  if (
    !isRecord(data) ||
    data.id !== id ||
    typeof data.name !== 'string' ||
    !data.name.trim() ||
    (data.series != null && typeof data.series !== 'string')
  ) {
    throw unexpected('personnage');
  }
  const series = typeof data.series === 'string' ? data.series.trim() : '';
  return {
    name: data.name.trim(),
    series: series || null,
    ...(typeof data.rarity === 'string' && /^[CURELM]$/.test(data.rarity)
      ? { rarity: data.rarity }
      : {}),
  };
}

export interface PriceServiceOptions {
  fetchImpl?: typeof fetch;
  now?: () => number;
  wait?: (ms: number) => Promise<void>;
  concurrency?: number;
  spacing?: number;
  timeout?: number;
  cacheTTL?: number;
  maxEntries?: number;
  recentSalesRarities?: boolean;
  /** En-têtes d'authentification du site (jeton, appareil), si l'utilisateur est connecté. */
  getHeaders?: () => Record<string, string>;
}

export type CardResult = Quote & Partial<CharacterInfo>;

/**
 * Service de prix : lectures GET avec les cookies et en-têtes de session du site, mises en file avec un départ espacé, un
 * cooldown partagé sur 429/503 et un cache borné.
 */
export function createPriceService(options: PriceServiceOptions = {}) {
  const fetchImpl = options.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const now = options.now ?? Date.now;
  const wait = options.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const concurrency = options.concurrency ?? 3;
  const spacing = options.spacing ?? 250;
  const timeout = options.timeout ?? 12_000;
  const cacheTTL = options.cacheTTL ?? CACHE_TTL;
  const maxEntries = options.maxEntries ?? MAX_CACHE_ENTRIES;
  const recentSalesRarities = options.recentSalesRarities ?? false;

  const cache = new Map<number, CardResult>();
  const pending = new Map<number, Promise<CardResult>>();
  const queue: { id: number; resolve: (value: CardResult) => void }[] = [];
  const metadata = new Map<number, CharacterInfo>();
  let active = 0;
  let nextStart = 0;
  let cooldownUntil = 0;
  let starting = false;

  const trim = <K, V>(map: Map<K, V>) => {
    while (map.size > maxEntries) map.delete(map.keys().next().value as K);
  };

  function rememberMetadata(id: number, value: Partial<CharacterInfo> | null | undefined): void {
    if (!recentSalesRarities || !value?.name || !/^[LM]$/.test(value.rarity ?? '')) return;
    metadata.delete(id);
    metadata.set(id, { name: value.name, series: value.series || null, rarity: value.rarity });
    trim(metadata);
  }

  function peek(id: number): CardResult | null {
    const entry = cache.get(id);
    if (!entry) return null;
    if (entry.expiresAt <= now()) {
      cache.delete(id);
      return null;
    }
    // Les entrées récemment utilisées survivent quand le cache atteint sa limite.
    cache.delete(id);
    cache.set(id, entry);
    return entry;
  }

  function remember(id: number, entry: CardResult): CardResult {
    cache.delete(id);
    cache.set(id, entry);
    trim(cache);
    return entry;
  }

  async function load(id: number): Promise<CardResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    let character: Partial<CharacterInfo> = {};
    try {
      const request = async (path: string): Promise<unknown> => {
        const response = await fetchImpl(`${ORIGIN}/api${path}`, {
          method: 'GET',
          // Le site refuse (403) les lectures sans ses cookies de session.
          credentials: 'include',
          redirect: 'error',
          cache: 'no-store',
          headers: { Accept: 'application/json', ...options.getHeaders?.() },
          signal: controller.signal,
        });
        if (!response.ok) {
          if (response.status === 429 || response.status === 503) {
            cooldownUntil = Math.max(
              cooldownUntil,
              now() + retryDelay(response.headers.get('Retry-After'), now()),
            );
          }
          throw new Error(`HTTP ${response.status}`);
        }
        return response.json();
      };

      const known = metadata.get(id);
      const data = known ? null : await request(`/characters/${id}`);
      character = known ?? normalizeCharacter(data, id);
      rememberMetadata(id, character);
      // La réponse publique d'un personnage contient normalement les deux médianes ;
      // sinon on lit l'endpoint du graphique de prix du site.
      const recent = recentSalesRarities && /^[LM]$/.test(character.rarity ?? '');
      const embedded = isRecord(data) ? data.prices : undefined;
      const prices =
        embedded && (!recent || (isRecord(embedded) && Array.isArray(embedded.lastSales)))
          ? embedded
          : await request(`/market/prices/${id}`);
      const result = recent ? recentPrices(prices, id) : normalizePrices(prices, id);
      const fetchedAt = now();
      return remember(id, {
        ...result,
        ...character,
        fetchedAt,
        expiresAt:
          fetchedAt +
          (result.status === 'empty'
            ? EMPTY_TTL
            : recent
              ? Math.min(cacheTTL, RECENT_TTL)
              : cacheTTL),
      });
    } catch (error) {
      console.warn(`[Kyara Plus] prix de la carte ${id} indisponible :`, error);
      const fetchedAt = now();
      const aborted = error instanceof Error && error.name === 'AbortError';
      return remember(id, {
        ...character,
        status: 'error',
        value: null,
        period: null,
        message: aborted
          ? 'Délai de réponse dépassé'
          : error instanceof Error
            ? error.message
            : 'Erreur',
        fetchedAt,
        expiresAt: Math.max(fetchedAt + ERROR_TTL, cooldownUntil),
      });
    } finally {
      clearTimeout(timer);
    }
  }

  /** Les départs sont échelonnés, même quand plusieurs cartes deviennent visibles ensemble. */
  async function pump(): Promise<void> {
    if (starting) return;
    starting = true;
    try {
      while (queue.length && active < concurrency) {
        const delay = Math.max(nextStart, cooldownUntil) - now();
        if (delay > 0) {
          await wait(delay);
          continue; // Une requête en cours a pu prolonger le cooldown partagé.
        }
        const task = queue.shift();
        if (!task) break;
        active += 1;
        nextStart = now() + spacing;
        void load(task.id)
          .then(task.resolve)
          .finally(() => {
            pending.delete(task.id);
            active -= 1;
            void pump();
          });
      }
    } finally {
      starting = false;
    }
  }

  const validId = (id: number) => Number.isSafeInteger(id) && id > 0;

  function get(id: number): Promise<CardResult> {
    if (!validId(id)) return Promise.reject(new Error('Carte invalide'));
    const entry = peek(id);
    if (entry) return Promise.resolve(entry);
    const inFlight = pending.get(id);
    if (inFlight) return inFlight;
    const promise = new Promise<CardResult>((resolve) => queue.push({ id, resolve }));
    pending.set(id, promise);
    void pump();
    return promise;
  }

  const fresh = new Map<number, Promise<CardResult>>();

  function refresh(id: number): Promise<CardResult> {
    if (!validId(id)) return Promise.reject(new Error('Carte invalide'));
    const running = fresh.get(id);
    if (running) return running;
    const promise = (async () => {
      const inFlight = pending.get(id);
      if (inFlight) await inFlight;
      // Un cooldown suite à une erreur est respecté même quand une action demande un prix frais.
      const previous = peek(id);
      if (previous?.status === 'error') return previous;
      cache.delete(id);
      return get(id);
    })().finally(() => fresh.delete(id));
    fresh.set(id, promise);
    return promise;
  }

  /** Intègre une cotation lue ailleurs (cache partagé) si elle est cohérente. */
  function adopt(id: number, result: Partial<CardResult> | null): boolean {
    if (!result) return false;
    if (validId(id)) rememberMetadata(id, result);
    const lm = /^[LM]$/.test(result.rarity ?? '');
    if (recentSalesRarities && lm && result.status !== 'error') {
      const size = result.sampleSize;
      if (
        result.basis !== 'last10' ||
        !Number.isSafeInteger(size) ||
        (size as number) < 0 ||
        (size as number) > 10
      ) {
        return false;
      }
    }
    const { status, fetchedAt, expiresAt, value } = result;
    if (
      !validId(id) ||
      !status ||
      !['ok', 'empty', 'error'].includes(status) ||
      !Number.isFinite(fetchedAt) ||
      !Number.isFinite(expiresAt) ||
      (expiresAt as number) <= (fetchedAt as number)
    ) {
      return false;
    }
    if (status === 'ok') {
      const last10 =
        result.basis === 'last10' &&
        result.period === null &&
        Number.isSafeInteger(result.sampleSize) &&
        (result.sampleSize as number) >= 1 &&
        (result.sampleSize as number) <= 10;
      if (
        typeof value !== 'number' ||
        !Number.isFinite(value) ||
        value < 0 ||
        !(last10 || result.period === 7 || result.period === 30)
      ) {
        return false;
      }
    } else if (value !== null) {
      return false;
    }
    const merged = { ...cache.get(id), ...result } as CardResult;
    if (merged.basis === 'last10') {
      merged.expiresAt = Math.min(merged.expiresAt, merged.fetchedAt + RECENT_TTL);
    }
    for (const field of ['sales7d', 'sales30d'] as const) {
      const v = result[field];
      if (!Number.isSafeInteger(v) || (v as number) < 0) delete merged[field];
    }
    remember(id, merged);
    return true;
  }

  return { get, refresh, adopt, peek };
}

export type PriceService = ReturnType<typeof createPriceService>;
