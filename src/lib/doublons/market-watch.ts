import { storage } from 'wxt/utils/storage';
import { AuthError, PassRequiredError } from '../api';
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
 * Veilles de prix sur le marché : chaque veille garde ses critères, son intervalle et les
 * annonces déjà signalées. Toutes les quelques minutes, et seulement dans un onglet
 * visible, la recherche est relue et chaque nouvelle affaire devient une alerte locale
 * (`market:listing:<id>:<palier>`). Un palier descendant produit une nouvelle alerte,
 * donc une baisse de prix réelle reste visible.
 *
 * Rien n'est acheté ni ajouté sur le site. Le budget est borné (2 pages, 20 alertes) pour
 * rester sous les limites de Kyara ; un refus met la veille concernée en pause.
 */

/** Page du marché : le lien d'une annonce s'y ouvre. */
export const MARKET_WATCH_HREF = 'https://kyara.games/marche';
/** Intervalle proposé par défaut entre deux passes. */
export const MARKET_WATCH_DEFAULT_INTERVAL_MS = 10 * 60_000;
/** Intervalles proposés dans le panneau, en minutes. */
export const MARKET_WATCH_INTERVALS_MIN = [5, 10, 15, 30] as const;
/** Veilles simultanées : au-delà, le budget de requêtes n'a plus de sens. */
export const MARKET_WATCH_MAX = 8;
/** Pages lues par passe : borne le coût d'une veille (96 annonces). */
export const MARKET_WATCH_PAGES = 2;
/** Annonces alertées par passe, pour ne pas noyer la cloche. */
export const MARKET_WATCH_ALERT_MAX = 20;
/** Annonces déjà signalées, gardées pour dédupliquer (`id:palier`). */
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
  /** Identifiant stable, pour modifier ou supprimer une veille. */
  id: string;
  /** Nom lisible choisi par l'utilisateur (« Mes envies », « Légendaires »). */
  label: string;
  enabled: boolean;
  intervalMs: number;
  criteria: MarketWatchCriteria;
  /** Dernière passe réussie. */
  at: number;
  /** Annonces déjà alertées (`id:palier`), pour ne pas répéter la même alerte. */
  seen: string[];
  /** Instant avant lequel on ne relit pas (limite de débit ou échec). */
  retryAt: number;
  /** Dernier refus ou échec, affiché dans le panneau. */
  lastError: string | null;
  /** Alertes créées à la dernière passe. */
  lastAlerts: number;
}

/** Le carnet de veilles, source unique du panneau et des boucles. */
export interface MarketWatchBook {
  watches: MarketWatchConfig[];
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
  // Le plafond suit le dernier intervalle proposé : choisir 30 min doit rester 30 min.
  const max = (MARKET_WATCH_INTERVALS_MIN[MARKET_WATCH_INTERVALS_MIN.length - 1] ?? 30) * 60_000;
  return Math.min(max, Math.max(min, Math.trunc(number)));
}

/** Identifiant court et stable pour une nouvelle veille. */
export function newWatchId(now = Date.now()): string {
  return `v${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`.slice(0, 24);
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
    id: text(source.id, 24),
    label: text(source.label, 60),
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

/** Une nouvelle veille nommée, coupée par défaut. */
export function newWatch(
  criteria: MarketWatchCriteria,
  label: string,
  now = Date.now(),
  intervalMs = MARKET_WATCH_DEFAULT_INTERVAL_MS,
): MarketWatchConfig {
  return normalizeMarketWatch({
    id: newWatchId(now),
    label: label.trim() || 'Nouvelle veille',
    enabled: true,
    intervalMs,
    criteria,
    at: 0,
    seen: [],
  });
}

/** Ancienne clé d'une veille unique, migrée dans le carnet à la première lecture. */
export const marketWatchItem = storage.defineItem<MarketWatchConfig>('local:marketWatch', {
  fallback: normalizeMarketWatch(null),
  version: 1,
});

export const marketWatchBookItem = storage.defineItem<MarketWatchBook>('local:marketWatches', {
  fallback: { watches: [] },
  version: 1,
});

/** Relit le carnet sans jamais faire confiance à sa forme, et borne le nombre de veilles. */
export function normalizeWatchBook(raw: unknown): MarketWatchBook {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const rows = Array.isArray(source.watches) ? source.watches : [];
  const watches: MarketWatchConfig[] = [];
  const ids = new Set<string>();
  for (const row of rows) {
    const watch = normalizeMarketWatch(row);
    if (!watch.id || ids.has(watch.id)) continue;
    ids.add(watch.id);
    watches.push({ ...watch, label: watch.label || defaultLabel(watch) });
    if (watches.length >= MARKET_WATCH_MAX) break;
  }
  return { watches };
}

/** Nom de repli, pour une veille enregistrée sans libellé. */
export function defaultLabel(watch: MarketWatchConfig): string {
  if (watch.criteria.wishOnly) return 'Mes envies';
  if (watch.criteria.text) return watch.criteria.text;
  if (watch.criteria.rarity) return `Rareté ${watch.criteria.rarity}`;
  return 'Marché';
}

/** Ajoute ou remplace une veille ; la première de la liste passe devant. */
export function upsertWatch(book: MarketWatchBook, watch: MarketWatchConfig): MarketWatchBook {
  const watches = normalizeWatchBook(book).watches;
  const index = watches.findIndex((entry) => entry.id === watch.id);
  if (index >= 0) watches[index] = { ...watches[index], ...watch };
  else watches.push(watch);
  return { watches: watches.slice(0, MARKET_WATCH_MAX) };
}

export function removeWatch(book: MarketWatchBook, id: string): MarketWatchBook {
  return { watches: normalizeWatchBook(book).watches.filter((watch) => watch.id !== id) };
}

/** Applique un correctif partiel sans perdre les champs non cités. */
export function patchWatch(
  book: MarketWatchBook,
  id: string,
  patch: Partial<MarketWatchConfig>,
): MarketWatchBook {
  const current = normalizeWatchBook(book).watches.find((watch) => watch.id === id);
  if (!current) return normalizeWatchBook(book);
  return upsertWatch(book, { ...current, ...patch, id: current.id });
}

/**
 * Lit le carnet ; une installation qui n'a connu que la veille unique la retrouve migrée
 * en une entrée, sans rien perdre de ses critères ni de ses annonces déjà vues.
 */
export async function loadWatchBook(): Promise<MarketWatchBook> {
  const book = normalizeWatchBook(await marketWatchBookItem.getValue().catch(() => null));
  if (book.watches.length) return book;
  const legacy = normalizeMarketWatch(await marketWatchItem.getValue().catch(() => null));
  if (!legacy.enabled && !legacy.at && !legacy.criteria.text && !legacy.criteria.wishOnly) {
    return book;
  }
  return {
    watches: [
      {
        ...legacy,
        id: legacy.id || 'historique',
        label: legacy.label || defaultLabel(legacy),
      },
    ],
  };
}

export async function saveWatchBook(book: MarketWatchBook): Promise<void> {
  await marketWatchBookItem.setValue(normalizeWatchBook(book));
}

/** Palier d'une annonce : un cran de 5 % sous la médiane, sinon deux chiffres significatifs. */
export function listingAlertTier(listing: MarketListing): string {
  const discount = listingDiscount(listing);
  if (discount !== null && discount < 0) return `m${Math.floor(Math.abs(discount) / 5) * 5}`;
  return `p${significant(listing.price, 2)}`;
}

/** Arrondi à `digits` chiffres significatifs, pour regrouper des prix proches. */
function significant(value: number, digits: number): number {
  const abs = Math.max(1, Math.abs(value));
  const magnitude = Math.pow(10, Math.floor(Math.log10(abs)) - digits + 1);
  return Math.round(value / magnitude) * magnitude;
}

/** Une annonce retenue devient une alerte lisible, liée à son annonce et à son palier. */
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
    key: `market:listing:${listing.id}:${listingAlertTier(listing)}`,
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
  /** Configuration injectée, pour les tests (une seule veille). */
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
  /**
   * Session expirée ou vérification anti-robot : elles ont leur propre reprise et ne
   * comptent pas dans le coupe-circuit.
   */
  auth?: boolean;
  at: number;
  /** Veille concernée (carnet) ; vide pour une passe sur une configuration seule. */
  id: string;
  label: string;
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
 * qui n'était pas encore alerté à ce palier ni possédé, et enregistre les alertes. Un
 * échec met la veille en pause au lieu de réessayer en rafale.
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
  const base = { id: config.id, label: config.label, at: config.at };

  if (!config.enabled) {
    return { ...base, ok: false, skipped: 'disabled', alerts: 0, listings: 0, error: null };
  }
  // Jamais lue : la première passe est due tout de suite, pas dans un intervalle.
  const dueAt = config.at > 0 ? Math.max(config.at + config.intervalMs, config.retryAt) : config.retryAt;
  if (!options.force && now < dueAt) {
    return { ...base, ok: false, skipped: 'waiting', alerts: 0, listings: 0, error: null };
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
        return { ...base, ok: false, skipped: 'no-criteria', alerts: 0, listings: 0, error: null };
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
    // Le palier fait partie de la clé : une baisse de 5 % sous la médiane redevient une info.
    const fresh = listings
      .filter((listing) => {
        const key = `${listing.id}:${listingAlertTier(listing)}`;
        return !seen.has(key) && !seen.has(listing.id) && !owned.has(listing.characterId);
      })
      .slice(0, MARKET_WATCH_ALERT_MAX);
    const alerts = fresh.map((listing) => watchListingAlert(listing, now));
    await record(alerts, now);
    const next: MarketWatchConfig = {
      ...config,
      at: now,
      retryAt: 0,
      lastError: null,
      lastAlerts: alerts.length,
      seen: [
        ...fresh.map((listing) => `${listing.id}:${listingAlertTier(listing)}`),
        ...config.seen,
      ].slice(0, MARKET_WATCH_SEEN_MAX),
    };
    await save(next);
    return {
      ...base,
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
    const auth = error instanceof AuthError || error instanceof PassRequiredError;
    return { ...base, ok: false, skipped: null, alerts: 0, listings: 0, error: message, auth };
  }
}

export interface MarketWatchBookRunOptions extends Omit<MarketWatchRunOptions, 'config'> {
  /** Une seule veille à relire (« Veiller maintenant » depuis sa ligne). */
  onlyId?: string;
  loadBook?: () => Promise<MarketWatchBook>;
  saveBook?: (book: MarketWatchBook) => Promise<void>;
}

export interface MarketWatchBookRun {
  runs: MarketWatchRun[];
  alerts: number;
  listings: number;
  error: string | null;
  /** L'erreur retenue vient d'une session, d'une vérification ou d'une limite de débit. */
  auth?: boolean;
  ran: number;
}

/**
 * Une passe pour chaque veille active : les critères, l'intervalle et les annonces déjà
 * vues restent propres à chacune, et une veille en échec n'empêche pas les autres.
 */
export async function runMarketWatchBook(
  options: MarketWatchBookRunOptions,
): Promise<MarketWatchBookRun> {
  let book = normalizeWatchBook(
    await (options.loadBook ?? loadWatchBook)().catch((): MarketWatchBook => ({ watches: [] })),
  );
  const saveBook =
    options.saveBook ?? ((next: MarketWatchBook) => saveWatchBook(next));
  const runs: MarketWatchRun[] = [];
  let alerts = 0;
  let listings = 0;
  let error: string | null = null;
  let auth = false;
  let ran = 0;
  for (const watch of book.watches) {
    if (!watch.enabled) continue;
    if (options.onlyId && watch.id !== options.onlyId) continue;
    const run = await runMarketWatch({
      ...options,
      config: watch,
      saveConfig: async (next) => {
        book = upsertWatch(book, next);
        await saveBook(book);
      },
    });
    runs.push(run);
    if (run.ok) ran += 1;
    alerts += run.alerts;
    listings += run.listings;
    if (run.error && !error) {
      error = `${watch.label} : ${run.error}`;
      auth = run.auth === true;
    }
  }
  return { runs, alerts, listings, error, auth, ran };
}

export interface MarketWatchLoopOptions {
  api: Api;
  document: Document;
  now?: () => number;
  /** Passe injectée, pour les tests. */
  run?: (options: MarketWatchBookRunOptions) => Promise<MarketWatchBookRun>;
  /** Cadence des contrôles : la veille elle-même ne relit qu'à l'intervalle réglé. */
  tickMs?: number;
  /** Coupe-circuit : quand il est ouvert, aucune passe n'est lancée. */
  isEnabled?: () => Promise<boolean>;
  /** Résultat d'une passe, pour les compteurs d'échecs. */
  onResult?: (run: MarketWatchBookRun) => void | Promise<void>;
}

export interface MarketWatchLoop {
  /** Une passe sur les veilles dues, si l'onglet est visible. */
  tick(): Promise<MarketWatchBookRun | null>;
  stop(): void;
}

/**
 * Une passe ne vaut réussite que si une veille a réellement été relue sans erreur. Une
 * passe « rien à relire » (intervalle pas écoulé, veilles coupées) ne prouve rien : la
 * compter comme un succès effacerait la série d'échecs de l'autre boucle de veille.
 */
export function watchPassSucceeded(run: MarketWatchBookRun): boolean {
  return !run.error && run.runs.some((entry) => entry.ok);
}

/**
 * Boucle de veille : un contrôle par minute, jamais dans un onglet masqué, et une
 * lecture seulement quand l'intervalle réglé est écoulé. Le site reste l'autorité :
 * une erreur est notée et retentée plus tard.
 */
export function startMarketWatchLoop(options: MarketWatchLoopOptions): MarketWatchLoop {
  const now = options.now ?? Date.now;
  const tickMs = options.tickMs ?? 60_000;
  const run = options.run ?? runMarketWatchBook;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let busy = false;

  const tick = async (): Promise<MarketWatchBookRun | null> => {
    if (stopped || busy) return null;
    if (options.document.visibilityState !== 'visible') return null;
    if (options.isEnabled && !(await options.isEnabled())) return null;
    busy = true;
    try {
      const result = await run({ api: options.api, now: now() });
      await options.onResult?.(result);
      return result;
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
