import {
  EMPTY_TTL,
  RECENT_TTL,
  createPriceService,
  normalizePrices,
  type CardResult,
  type PriceService,
} from './prices';

export const CACHE_KEY = 'kyara-plus:prices:v1';
export const DAY = 24 * 60 * 60 * 1000;
export const LIMIT = 3000;

type Raw = Record<string, unknown>;

const finite = (n: unknown): n is number | null =>
  n === null ||
  (typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= Number.MAX_SAFE_INTEGER);

/**
 * Ne persiste que des cotations publiques validées. Aucun inventaire, compte ni jeton ne fait
 * partie de ce schéma. Une valeur douteuse est rejetée plutôt que réparée.
 */
export function sanitize(id: number, value: unknown, now = Date.now()): CardResult | null {
  if (!Number.isSafeInteger(id) || id < 1 || !value || typeof value !== 'object') return null;
  const v = value as Raw;
  const fetchedAt = v.fetchedAt;
  const expiresAt = v.expiresAt;
  if (
    !['ok', 'empty', 'error'].includes(v.status as string) ||
    !Number.isSafeInteger(fetchedAt) ||
    (fetchedAt as number) < 1 ||
    (fetchedAt as number) > now + 60_000 ||
    !Number.isSafeInteger(expiresAt) ||
    (expiresAt as number) <= now ||
    (expiresAt as number) <= (fetchedAt as number) ||
    (expiresAt as number) > (fetchedAt as number) + DAY ||
    typeof v.name !== 'string' ||
    !v.name.trim() ||
    v.name.length > 200 ||
    !(v.series === null || (typeof v.series === 'string' && v.series.length <= 300))
  ) {
    return null;
  }
  if (!finite(v.median7d ?? null) || !finite(v.median30d ?? null)) return null;

  const sampleSize = v.sampleSize;
  const recent =
    v.basis === 'last10' &&
    v.period === null &&
    Number.isSafeInteger(sampleSize) &&
    (sampleSize as number) >= 0 &&
    (sampleSize as number) <= 10;

  if (v.status === 'ok') {
    const matchesPeriod =
      (v.period === 7 || v.period === 30) &&
      v.value === (v.period === 7 ? v.median7d : v.median30d);
    if (
      !finite(v.value) ||
      v.value === null ||
      !((recent && (sampleSize as number) > 0) || matchesPeriod)
    ) {
      return null;
    }
  } else if (v.value !== null) {
    return null;
  }

  const quote: CardResult = {
    status: v.status as CardResult['status'],
    value: v.value as number | null,
    period: v.status === 'ok' ? (v.period as 7 | 30 | null) : null,
    median7d: (v.median7d as number | null | undefined) ?? null,
    median30d: (v.median30d as number | null | undefined) ?? null,
    name: v.name.trim(),
    series: v.series as string | null,
    fetchedAt: fetchedAt as number,
    expiresAt: expiresAt as number,
  };
  if (typeof v.rarity === 'string' && /^[CURELM]$/.test(v.rarity)) quote.rarity = v.rarity;
  if (recent) {
    quote.basis = 'last10';
    quote.sampleSize = sampleSize as number;
    quote.expiresAt = Math.min(quote.expiresAt, quote.fetchedAt + RECENT_TTL);
    if (quote.expiresAt <= now) return null;
  }
  for (const field of ['sales7d', 'sales30d'] as const) {
    const n = v[field];
    if (Number.isSafeInteger(n) && (n as number) >= 0) quote[field] = n as number;
  }
  if (v.status === 'error') {
    quote.message =
      typeof v.message === 'string' ? v.message.slice(0, 200) : 'Lecture indisponible';
  }
  return quote;
}

export function decode(value: unknown, now: number): Map<number, CardResult> {
  const records = new Map<number, CardResult>();
  const stored = value as { version?: unknown; records?: unknown } | null | undefined;
  if (stored?.version !== 1 || !Array.isArray(stored.records) || stored.records.length > LIMIT) {
    return records;
  }
  for (const row of stored.records as unknown[]) {
    if (!Array.isArray(row) || row.length !== 2) continue;
    const id = row[0] as number;
    const quote = sanitize(id, row[1], now);
    const known = records.get(id);
    if (quote && (!known || known.fetchedAt < quote.fetchedAt)) records.set(id, quote);
  }
  return records;
}

export interface KeyValueStorage {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export interface CachedServiceOptions {
  storage: KeyValueStorage;
  subscribe?: (listener: (changes: Record<string, { newValue?: unknown }>) => void) => void;
  now?: () => number;
  /** Verrou entre onglets pour l'écriture (Web Locks). */
  lock?: <T>(action: () => Promise<T>) => Promise<T>;
  recentSalesRarities?: boolean;
  getHeaders?: () => Record<string, string>;
  engine?: PriceService;
}

/** Service de prix avec cache persistant partagé entre onglets, écrit au plus une fois par seconde. */
export function createCachedPriceService(options: CachedServiceOptions) {
  const { storage } = options;
  const now = options.now ?? Date.now;
  const lock = options.lock ?? (<T>(action: () => Promise<T>) => action());
  const engine =
    options.engine ??
    createPriceService({
      cacheTTL: DAY,
      maxEntries: LIMIT,
      recentSalesRarities: options.recentSalesRarities,
      getHeaders: options.getHeaders,
      now,
    });

  const records = new Map<number, CardResult>();
  const dirty = new Map<number, CardResult>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let writing: Promise<void> | null = null;
  let error = '';

  const trim = () => {
    while (records.size > LIMIT) records.delete(records.keys().next().value as number);
  };

  function merge(incoming: Map<number, CardResult>): void {
    for (const [id, quote] of incoming) {
      const current = records.get(id);
      if (!current || quote.fetchedAt >= current.fetchedAt) {
        records.set(id, quote);
        engine.adopt(id, quote);
      }
    }
    trim();
  }

  options.subscribe?.((changes) => {
    const change = changes[CACHE_KEY];
    if (change) merge(decode(change.newValue, now()));
  });

  const ready = Promise.resolve()
    .then(() => storage.get(CACHE_KEY))
    .then((data) => merge(decode(data[CACHE_KEY], now())))
    .catch(() => {
      error = 'Cache local indisponible ; lecture publique utilisée.';
    });

  async function flush(): Promise<void> {
    clearTimeout(timer);
    if (writing) {
      await writing;
      if (dirty.size) return flush();
      return;
    }
    if (!dirty.size) return;
    const batch = new Map(dirty);
    dirty.clear();
    writing = lock(async () => {
      const stored = decode((await storage.get(CACHE_KEY))[CACHE_KEY], now());
      for (const [id, quote] of batch) {
        const known = stored.get(id);
        if (!known || known.fetchedAt <= quote.fetchedAt) stored.set(id, quote);
      }
      const rows = [...stored]
        .filter(([id, quote]) => sanitize(id, quote, now()))
        .sort((a, b) => b[1].fetchedAt - a[1].fetchedAt)
        .slice(0, LIMIT);
      await storage.set({ [CACHE_KEY]: { version: 1, records: rows } });
      error = '';
    })
      .catch(() => {
        error = 'Cache non enregistré ; les prix restent disponibles dans cet onglet.';
      })
      .finally(() => {
        writing = null;
      });
    await writing;
  }

  function remember(id: number, value: Partial<CardResult>): void {
    const quote = sanitize(id, { ...records.get(id), ...value }, now());
    if (!quote) return;
    const current = records.get(id);
    if (
      current &&
      (current.fetchedAt > quote.fetchedAt || JSON.stringify(current) === JSON.stringify(quote))
    ) {
      return;
    }
    records.set(id, quote);
    dirty.set(id, quote);
    trim();
    clearTimeout(timer);
    timer = setTimeout(() => void flush(), 1000);
  }

  return {
    ready,
    peek: engine.peek,
    flush,
    get error() {
      return error;
    },
    async get(id: number): Promise<CardResult> {
      await ready;
      const result = await engine.get(id);
      remember(id, result);
      return result;
    },
    async refresh(id: number): Promise<CardResult> {
      await ready;
      const result = await engine.refresh(id);
      remember(id, result);
      return result;
    },
    adopt(id: number, result: Partial<CardResult>): boolean {
      const value =
        result.status === 'ok' && result.fetchedAt !== undefined
          ? {
              ...result,
              expiresAt: result.fetchedAt + (result.basis === 'last10' ? RECENT_TTL : DAY),
            }
          : result;
      const quote = sanitize(id, { ...records.get(id), ...value }, now());
      if (!engine.adopt(id, quote ?? value)) return false;
      remember(id, quote ?? value);
      return true;
    },
    destroy(): void {
      clearTimeout(timer);
    },
  };
}

export type CachedPriceService = ReturnType<typeof createCachedPriceService>;

/** Cotation issue d'un lot de prix en masse (même schéma validé). */
export function ingest(
  service: Pick<CachedPriceService, 'adopt'>,
  prices: {
    id: number;
    median7d?: number | null;
    median30d?: number | null;
    sales7d?: number;
    sales30d?: number;
  }[],
  catalogue: { id: number; name: string; series?: string; rarity: string }[],
  at = Date.now(),
): void {
  const cards = new Map(catalogue.map((card) => [card.id, card]));
  for (const price of prices) {
    const card = cards.get(price.id);
    if (!card) continue;
    try {
      const quote = normalizePrices(
        {
          characterId: price.id,
          median7d: price.median7d ?? null,
          median30d: price.median30d ?? null,
          sales7d: price.sales7d,
          sales30d: price.sales30d,
        },
        price.id,
      );
      service.adopt(price.id, {
        ...quote,
        name: card.name,
        series: card.series || null,
        rarity: card.rarity,
        fetchedAt: at,
        expiresAt: at + (quote.status === 'ok' ? DAY : EMPTY_TTL),
      });
    } catch {
      // Un lot malformé ne doit jamais devenir une cotation utilisable.
    }
  }
}
