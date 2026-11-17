import { storage } from 'wxt/utils/storage';
import type { Alert } from '../alerts/model';
import { upsertAlerts } from '../alerts/store';
import { getCatalog } from '../catalog';
import type { Api } from './market';
import {
  formatEndsIn,
  listingDiscount,
  matchesWishCard,
  searchMarket,
  searchMarketCards,
  type MarketListing,
  type WishCardRef,
} from './market-search';
import { loadOwnedIds } from './owned';
import { loadWishlist } from './wishlist';

/**
 * Veille de prix sur les envies : toutes les quelques minutes, et seulement dans un
 * onglet visible, la recherche marché est relue avec les critères retenus et chaque
 * nouvelle annonce intéresse devient une alerte locale (`market:listing:<id>`).
 *
 * Rien n'est acheté ni ajouté sur le site. Le budget est borné (2 pages, 20 alertes)
 * pour rester sous les limites de Kyara ; un refus met la veille en pause.
 */

/** Page du marché : le lien d'une annonce s'y ouvre. */
export const MARKET_WATCH_HREF = 'https://kyara.games/marche';
/** Intervalle proposé par défaut entre deux passes. */
export const MARKET_WATCH_DEFAULT_INTERVAL_MS = 10 * 60_000;
/** Intervalles proposés dans le panneau, en minutes. */
export const MARKET_WATCH_INTERVALS_MIN = [5, 10, 15, 30] as const;
/** Pages lues par passe : borne le coût d'une veille (96 annonces). */
export const MARKET_WATCH_PAGES = 2;
/** Annonces alertées par passe, pour ne pas noyer la cloche. */
export const MARKET_WATCH_ALERT_MAX = 20;
/** Identifiants d'annonces déjà vues, gardés pour dédupliquer. */
export const MARKET_WATCH_SEEN_MAX = 300;
/** Après un échec ou une limite de débit, on attend au moins cette durée. */
export const MARKET_WATCH_RETRY_MS = 60_000;

/** Critères figés quand la veille est activée : ils ne suivent pas la saisie courante. */
export interface MarketWatchCriteria {
  text: string;
  series: string;
  rarity: string;
  wishOnly: boolean;
  noAuction: boolean;
  minDiscount: number;
  buyNow: boolean;
  missing: boolean;
}

export interface MarketWatchConfig {
  enabled: boolean;
  intervalMs: number;
  criteria: MarketWatchCriteria;
  /** Dernière passe réussie. */
  at: number;
  /** Annonces déjà alertées, pour ne pas répéter la même alerte. */
  seen: string[];
  /** Instant avant lequel on ne relit pas (limite de débit ou échec). */
  retryAt: number;
  /** Dernier refus ou échec, affiché dans le panneau. */
  lastError: string | null;
  /** Alertes créées à la dernière passe. */
  lastAlerts: number;
}

export const EMPTY_CRITERIA: MarketWatchCriteria = {
  text: '',
  series: '',
  rarity: '',
  wishOnly: false,
  noAuction: false,
  minDiscount: 0,
  buyNow: false,
  missing: false,
};

function text(value: unknown, max = 80): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function clampInterval(value: unknown): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return MARKET_WATCH_DEFAULT_INTERVAL_MS;
  const min = (MARKET_WATCH_INTERVALS_MIN[0] ?? 5) * 60_000;
  const max = (MARKET_WATCH_INTERVALS_MIN[2] ?? 15) * 60_000;
  return Math.min(max, Math.max(min, Math.trunc(number)));
}

/** Relit une configuration stockée : les valeurs douteuses retombent sur les défauts. */
export function normalizeMarketWatch(raw: unknown): MarketWatchConfig {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const criteria = source.criteria && typeof source.criteria === 'object'
    ? (source.criteria as Record<string, unknown>)
    : {};
  const at = Number(source.at);
  const retryAt = Number(source.retryAt);
  const lastAlerts = Number(source.lastAlerts);
  return {
    enabled: source.enabled === true,
    intervalMs: clampInterval(source.intervalMs),
    criteria: {
      text: text(criteria.text),
      series: text(criteria.series),
      rarity: text(criteria.rarity, 4),
      wishOnly: criteria.wishOnly === true,
      noAuction: criteria.noAuction === true,
      minDiscount: Math.max(0, Math.min(100, Math.trunc(Number(criteria.minDiscount) || 0))),
      buyNow: criteria.buyNow === true,
      missing: criteria.missing === true,
    },
    at: Number.isFinite(at) && at > 0 ? at : 0,
    seen: Array.isArray(source.seen)
      ? [...new Set(source.seen.filter((id): id is string => typeof id === 'string' && !!id))].slice(
          0,
          MARKET_WATCH_SEEN_MAX,
        )
      : [],
    retryAt: Number.isFinite(retryAt) && retryAt > 0 ? retryAt : 0,
    lastError: text(source.lastError, 200) || null,
    lastAlerts: Number.isFinite(lastAlerts) && lastAlerts > 0 ? Math.trunc(lastAlerts) : 0,
  };
}

export const marketWatchItem = storage.defineItem<MarketWatchConfig>('local:marketWatch', {
  fallback: normalizeMarketWatch(null),
  version: 1,
});

/** Une annonce retenue devient une alerte lisible, liée à son annonce. */
export function watchListingAlert(listing: MarketListing, now = Date.now()): Alert {
  const name = listing.name ?? `Carte #${listing.characterId}`;
  const discount = listingDiscount(listing);
  const ends = formatEndsIn(listing.endsAt, now);
  const details = [
    listing.seller ? `Vendeur ${listing.seller}` : '',
    listing.auction ? 'enchère' : 'prix fixe',
    ends ?? '',
  ].filter(Boolean);
  return {
    key: `market:listing:${listing.id}`,
    kind: 'market',
    title: `${name} à ${listing.price.toLocaleString('fr-FR')} ◆${
      discount !== null && discount < 0 ? ` (−${Math.abs(discount)} %)` : ''
    }`,
    message: details.join(' · '),
    at: now,
    read: false,
    href: `${MARKET_WATCH_HREF}?annonce=${encodeURIComponent(listing.id)}`,
    wishlist: true,
    cardId: listing.characterId,
  };
}

export interface MarketWatchRunOptions {
  api: Api;
  now?: number;
  /** Relit même si l'intervalle n'est pas écoulé (bouton « Veiller maintenant »). */
  force?: boolean;
  /** Configuration injectée, pour les tests. */
  config?: MarketWatchConfig;
  loadConfig?: () => Promise<MarketWatchConfig>;
  saveConfig?: (config: MarketWatchConfig) => Promise<void>;
  /** Envies nommées à interroger en mode « ★ Mes envies ». */
  loadCards?: () => Promise<WishCardRef[]>;
  /** Cartes possédées, à ne pas alerter. */
  loadOwned?: () => Promise<readonly number[]>;
  record?: (alerts: readonly Alert[], now: number) => Promise<unknown>;
  maxPages?: number;
  wait?: (ms: number) => Promise<void>;
}

export interface MarketWatchRun {
  ok: boolean;
  /** Rien n'a été lu : veille coupée, intervalle pas écoulé, ou aucune envie à lire. */
  skipped: 'disabled' | 'waiting' | 'no-criteria' | null;
  alerts: number;
  listings: number;
  error: string | null;
  at: number;
}

async function defaultCards(options: MarketWatchRunOptions): Promise<WishCardRef[]> {
  const criteria = normalizeMarketWatch(options.config).criteria;
  const [catalog, wishlist] = await Promise.all([getCatalog(options.api), loadWishlist(options.api)]);
  const metas = new Map(catalog.map((card) => [Number(card.id), card]));
  const cards: WishCardRef[] = [];
  for (const id of wishlist) {
    const meta = metas.get(id);
    const name = meta?.name?.trim();
    if (!name) continue;
    cards.push({ id, name, series: meta?.series ?? null, rarity: meta?.rarity ?? null });
  }
  return cards.filter((card) =>
    matchesWishCard(card, {
      text: criteria.text,
      series: criteria.series,
      rarity: criteria.rarity,
    }),
  );
}

/**
 * Une passe de veille : lit la recherche avec les critères retenus, ne garde que ce
 * qui n'était pas encore alerté ni possédé, et enregistre les alertes. Un échec met
 * la veille en pause au lieu de réessayer en rafale.
 */
export async function runMarketWatch(options: MarketWatchRunOptions): Promise<MarketWatchRun> {
  const now = options.now ?? Date.now();
  const config = normalizeMarketWatch(
    options.config ??
      (await (options.loadConfig ?? (() => marketWatchItem.getValue()))().catch(() => null)),
  );
  const save =
    options.saveConfig ?? ((next: MarketWatchConfig) => marketWatchItem.setValue(next));
  const record =
    options.record ?? ((alerts: readonly Alert[], at: number) => upsertAlerts([...alerts], at));

  if (!config.enabled) {
    return { ok: false, skipped: 'disabled', alerts: 0, listings: 0, error: null, at: config.at };
  }
  // Jamais lue : la première passe est due tout de suite, pas dans un intervalle.
  const dueAt = config.at > 0 ? Math.max(config.at + config.intervalMs, config.retryAt) : config.retryAt;
  if (!options.force && now < dueAt) {
    return { ok: false, skipped: 'waiting', alerts: 0, listings: 0, error: null, at: config.at };
  }

  const criteria = config.criteria;
  const pageFilters = {
    noAuction: criteria.noAuction,
    minDiscount: criteria.minDiscount,
    order: 'deal' as const,
  };
  try {
    let listings: MarketListing[];
    if (criteria.wishOnly) {
      const cards = await (options.loadCards ?? (() => defaultCards(options)))();
      if (!cards.length) {
        return {
          ok: false,
          skipped: 'no-criteria',
          alerts: 0,
          listings: 0,
          error: null,
          at: config.at,
        };
      }
      const result = await searchMarketCards(options.api, cards, {
        ...pageFilters,
        sort: 'newest',
        maxCards: MARKET_WATCH_ALERT_MAX,
        pagesPerCard: 1,
        buyNow: criteria.buyNow,
        missing: criteria.missing,
        wait: options.wait,
      });
      listings = result.listings;
    } else {
      const result = await searchMarket(
        options.api,
        {
          text: criteria.text,
          series: criteria.series,
          rarity: criteria.rarity,
          sort: 'newest',
          buyNow: criteria.buyNow,
          missing: criteria.missing,
        },
        {
          ...pageFilters,
          maxPages: Math.max(1, Math.trunc(options.maxPages ?? MARKET_WATCH_PAGES)),
          wait: options.wait,
        },
      );
      listings = result.listings;
    }

    const owned = new Set(
      await (options.loadOwned ?? (() => loadOwnedIds(options.api)))().catch((): number[] => []),
    );
    const seen = new Set(config.seen);
    const fresh = listings
      .filter((listing) => !seen.has(listing.id) && !owned.has(listing.characterId))
      .slice(0, MARKET_WATCH_ALERT_MAX);
    const alerts = fresh.map((listing) => watchListingAlert(listing, now));
    await record(alerts, now);
    const next: MarketWatchConfig = {
      ...config,
      at: now,
      retryAt: 0,
      lastError: null,
      lastAlerts: alerts.length,
      seen: [...fresh.map((listing) => listing.id), ...config.seen].slice(0, MARKET_WATCH_SEEN_MAX),
    };
    await save(next);
    return {
      ok: true,
      skipped: null,
      alerts: alerts.length,
      listings: listings.length,
      error: null,
      at: now,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Veille impossible';
    const retryAt = now + Math.max(MARKET_WATCH_RETRY_MS, config.intervalMs);
    await save({ ...config, retryAt, lastError: message }).catch(() => undefined);
    return { ok: false, skipped: null, alerts: 0, listings: 0, error: message, at: config.at };
  }
}

export interface MarketWatchLoopOptions {
  api: Api;
  document: Document;
  now?: () => number;
  /** Passe injectée, pour les tests. */
  run?: (options: MarketWatchRunOptions) => Promise<MarketWatchRun> | MarketWatchRun;
  /** Cadence des contrôles : la veille elle-même ne relit qu'à l'intervalle réglé. */
  tickMs?: number;
}

export interface MarketWatchLoop {
  /** Une passe, si l'onglet est visible et l'intervalle écoulé. */
  tick(): Promise<MarketWatchRun | null>;
  stop(): void;
}

/**
 * Boucle de veille : un contrôle par minute, jamais dans un onglet masqué, et une
 * lecture seulement quand l'intervalle réglé est écoulé. Le site reste l'autorité :
 * une erreur est notée et retentée plus tard.
 */
export function startMarketWatchLoop(options: MarketWatchLoopOptions): MarketWatchLoop {
  const now = options.now ?? Date.now;
  const tickMs = options.tickMs ?? 60_000;
  const run = options.run ?? runMarketWatch;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let busy = false;

  const tick = async (): Promise<MarketWatchRun | null> => {
    if (stopped || busy) return null;
    if (options.document.visibilityState !== 'visible') return null;
    busy = true;
    try {
      return await run({ api: options.api, now: now() });
    } finally {
      busy = false;
    }
  };

  const schedule = (): void => {
    timer = setTimeout(() => {
      void tick().then(
        () => {
          if (!stopped) schedule();
        },
        () => {
          if (!stopped) schedule();
        },
      );
    }, tickMs);
  };
  schedule();
  void tick();

  return {
    tick,
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
