import { call, type Api } from './market';

/**
 * Recherche dans tout le marché : lit les annonces actives page par page
 * (`GET /api/market/listings`), les normalise, puis les classe par meilleure
 * affaire — l'écart avec la médiane de prix du site.
 *
 * Rien n'est écrit : ce module ne fait que des lectures et ne touche ni à la
 * collection ni à la wishlist.
 */

/** Une annonce du marché réduite à ce qui sert à la recherche. */
export interface MarketListing {
  /** Identifiant de l'annonce, pour ouvrir `/marche?annonce=<id>`. */
  id: string;
  characterId: number;
  name: string | null;
  rarity: string | null;
  series: string | null;
  /** Prix demandé : enchère courante pour une enchère, prix fixe sinon. */
  price: number;
  /** Médiane de prix du site (7 j, sinon 30 j), quand elle est fournie. */
  median: number | null;
  auction: boolean;
  buyout: number | null;
  bids: number;
  endsAt: string | null;
  seller: string | null;
  /** Ventes des 7 derniers jours, quand le site les fournit. */
  sales7d?: number;
}

/** Critères envoyés à l'API, comme la barre de recherche du site. */
export interface MarketQuery {
  text?: string;
  series?: string;
  rarity?: string;
  sort?: 'newest' | 'ending';
  buyNow?: boolean;
  missing?: boolean;
}

/** Annonces demandées par page (le site refuse les gros lots). */
export const MARKET_PAGE_SIZE = 48;
/** Pages lues au maximum par recherche. */
export const MARKET_MAX_PAGES = 8;
/** Pause entre deux pages : le site coupe l'accès après une rafale. */
export const MARKET_PAGE_DELAY_MS = 600;
/**
 * Annonces gardées en mémoire au plus par recherche. « Tout lire » parcourt des dizaines de
 * milliers d'annonces ; les garder toutes faisait tomber l'onglet. Les meilleures affaires
 * restent, la couverture affichée continue de compter tout ce qui a été lu.
 */
export const MARKET_KEPT_MAX = 300;
/** Durée de validité d'une lecture d'envie, pour ne pas la refaire au bouton « Lire la suite ». */
export const WISH_CARD_CACHE_TTL_MS = 10 * 60_000;

const defaultWait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Attend un délai, sans bloquer une annulation demandée entre-temps. */
async function waitUnlessAbort(
  ms: number,
  wait: ((ms: number) => Promise<void>) | undefined,
  signal?: AbortSignal,
): Promise<void> {
  const sleeping = wait ? wait(ms) : defaultWait(ms);
  if (!signal) {
    await sleeping;
    return;
  }
  if (signal.aborted) return;
  await Promise.race([
    sleeping,
    new Promise<void>((resolve) => {
      const onAbort = (): void => resolve();
      signal.addEventListener('abort', onAbort, { once: true });
      void sleeping.then(() => signal.removeEventListener('abort', onAbort));
    }),
  ]);
}

/** Ordre « meilleure affaire d'abord », sans filtre : sert à ne garder que le haut de liste. */
function bestFirst(a: MarketListing, b: MarketListing): number {
  const left = listingDiscount(a);
  const right = listingDiscount(b);
  if (left === null && right === null) return a.price - b.price;
  if (left === null) return 1;
  if (right === null) return -1;
  return left - right || a.price - b.price;
}

/** Tronque une liste en gardant les meilleures affaires. */
export function keepBest(
  listings: readonly MarketListing[],
  max = MARKET_KEPT_MAX,
): MarketListing[] {
  if (listings.length <= max) return [...listings];
  return [...listings].sort(bestFirst).slice(0, Math.max(1, Math.trunc(max)));
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function positive(value: unknown): number | null {
  const number = typeof value === 'string' ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number) && number > 0 ? number : null;
}

function count(value: unknown): number {
  const number = typeof value === 'string' ? Number(value) : value;
  return typeof number === 'number' && Number.isSafeInteger(number) && number > 0 ? number : 0;
}

/** Chemin d'une page de résultats ; les critères vides ne sont pas envoyés. */
export function marketSearchPath(
  query: MarketQuery,
  page: number,
  pageSize = MARKET_PAGE_SIZE,
): string {
  const params = new URLSearchParams();
  const search = query.text?.trim();
  if (search) params.set('q', search);
  const series = query.series?.trim();
  if (series) params.set('series', series);
  if (query.rarity) params.set('rarity', query.rarity);
  params.set('sort', query.sort === 'ending' ? 'ending' : 'newest');
  if (query.buyNow) params.set('buyNow', '1');
  if (query.missing) params.set('missing', '1');
  params.set('page', String(Math.max(1, Math.trunc(page))));
  params.set('pageSize', String(Math.max(1, Math.trunc(pageSize))));
  return `/api/market/listings?${params.toString()}`;
}

/**
 * Normalise une page de résultats. Une annonce fermée, la mienne ou sans carte
 * exploitable est écartée plutôt que d'apparaître avec des valeurs inventées.
 */
export function normalizeListings(data: unknown): MarketListing[] {
  const items = isRecord(data) && Array.isArray(data.items) ? data.items : Array.isArray(data) ? data : null;
  if (!items) throw new Error('Réponse du marché inattendue');
  const listings: MarketListing[] = [];
  for (const item of items) {
    if (!isRecord(item)) continue;
    const id = text(item.id) ?? (positive(item.id) ? String(item.id) : null);
    if (!id) continue;
    if (item.status != null && item.status !== 'active') continue;
    if (item.isMine === true) continue;
    const character = isRecord(item.character) ? item.character : {};
    const characterId = positive(character.id) ?? positive(item.characterId);
    if (!characterId) continue;
    const auction = item.type === 'auction';
    const price =
      positive(auction ? (item.currentBid ?? item.minNextBid ?? item.price) : item.price) ?? null;
    if (price === null) continue;
    const prices = isRecord(item.prices) ? item.prices : {};
    const endsAt = typeof item.endsAt === 'string' && Number.isFinite(Date.parse(item.endsAt))
      ? item.endsAt
      : null;
    listings.push({
      id,
      characterId,
      name: text(character.name),
      rarity: text(character.rarity),
      series: text(character.series),
      price,
      median: positive(prices.median7d) ?? positive(prices.median30d),
      auction,
      buyout: auction ? positive(item.buyoutPrice) : null,
      bids: count(item.bidCount),
      sales7d: count(prices.sales7d),
      endsAt,
      seller: isRecord(item.seller) ? text(item.seller.pseudo) : null,
    });
  }
  return listings;
}

/** Écart avec la médiane, en pourcentage arrondi : −40 = 40 % sous la médiane. */
export function listingDiscount(listing: MarketListing): number | null {
  if (!listing.median || listing.median <= 0 || listing.price <= 0) return null;
  return Math.round((listing.price / listing.median - 1) * 100);
}

export interface DealFilters {
  /** Réduction minimale exigée sous la médiane (0 = tout garder). */
  minDiscount?: number;
  /** Garde seulement les cartes de cette liste d'envies. */
  wishlist?: ReadonlySet<number>;
  /** Écarte les enchères, même avec achat immédiat. */
  noAuction?: boolean;
  /**
   * Ordre des lignes : la meilleure affaire (défaut) ou la fin la plus proche.
   * Le site trie les pages ; ce choix dit comment les afficher sans contredire
   * la demande « fin imminente ».
   */
  order?: 'deal' | 'ending';
}

/** « fin dans 2 h », « fin dans 3 j » ; `null` quand l'échéance manque. */
export function formatEndsIn(endsAt: string | null, now = Date.now()): string | null {
  if (!endsAt) return null;
  const at = Date.parse(endsAt);
  if (!Number.isFinite(at)) return null;
  const left = at - now;
  if (left <= 0) return 'terminée';
  const minutes = Math.round(left / 60_000);
  if (minutes < 60) return `fin dans ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `fin dans ${hours} h`;
  return `fin dans ${Math.floor(hours / 24)} j`;
}

/**
 * Filtre puis classe les annonces par meilleure affaire : l'écart le plus
 * favorable d'abord, puis le prix le plus bas. Une annonce sans médiane connue
 * passe en dernier et n'est jamais retenue par un seuil de réduction.
 */
export function rankDeals(
  listings: readonly MarketListing[],
  filters: DealFilters = {},
): MarketListing[] {
  const minDiscount = Math.max(0, Math.min(100, Math.trunc(filters.minDiscount ?? 0)));
  const kept = listings
    .filter((listing) => {
      if (filters.noAuction && listing.auction) return false;
      if (filters.wishlist && !filters.wishlist.has(listing.characterId)) return false;
      if (!minDiscount) return true;
      const discount = listingDiscount(listing);
      return discount !== null && discount <= -minDiscount;
    })
    .sort((a, b) => {
      const left = listingDiscount(a);
      const right = listingDiscount(b);
      if (left === null && right === null) return a.price - b.price;
      if (left === null) return 1;
      if (right === null) return -1;
      return left - right || a.price - b.price;
    });
  if (filters.order !== 'ending') return kept;
  // Fin imminente : l'échéance la plus proche d'abord, les annonces sans fin en dernier.
  return kept.sort((a, b) => {
    const left = a.endsAt ? Date.parse(a.endsAt) : Number.POSITIVE_INFINITY;
    const right = b.endsAt ? Date.parse(b.endsAt) : Number.POSITIVE_INFINITY;
    return left - right || a.price - b.price;
  });
}

export interface MarketSearchOptions extends DealFilters {
  pageSize?: number;
  maxPages?: number;
  /** Première page lue ; `pages + 1` prolonge une lecture partielle. */
  startPage?: number;
  /** Pause entre deux pages, injectable pour les tests. */
  wait?: (ms: number) => Promise<void>;
  /** Annulation : la lecture s'arrête entre deux pages et rend ce qu'elle a lu. */
  signal?: AbortSignal;
  /** Annonce signalée au fil de la lecture, pour afficher la progression. */
  /** Appelée après chaque page ; `total` est le total annoncé par le site. */
  onPage?: (listings: readonly MarketListing[], page: number, total: number | null) => void;
}

export interface MarketSearchResult {
  listings: MarketListing[];
  /** Nombre d'annonces proposées par le site, si la réponse le donne. */
  total: number | null;
  pages: number;
  /** Faux quand la lecture s'est arrêtée avant la dernière page connue. */
  complete: boolean;
  /** Emplacements d'annonces lus (pages × taille de page), pour la couverture. */
  scanned?: number;
  /** Renseigné quand la lecture s'est faite envie par envie. */
  cards?: CardSearchSummary;
  /** Vrai quand l'utilisateur a arrêté la lecture. */
  aborted?: boolean;
  /** Annonces lues mais écartées pour rester sous `MARKET_KEPT_MAX`. */
  dropped?: number;
}

/** Une carte de la liste d'envies, réduite à ce qu'il faut pour la chercher. */
export interface WishCardRef {
  id: number;
  name: string;
  series?: string | null;
  rarity?: string | null;
  /** Médiane connue (prix en cache), pour prioriser les envies qui comptent. */
  median?: number | null;
}

const RARITY_RANK: Record<string, number> = { C: 1, U: 2, R: 3, E: 4, L: 5, M: 6 };

/**
 * Ordre de valeur des envies : rareté décroissante, puis médiane connue, puis nom. Une
 * passe ne lit que 20 cartes : commencer par les plus chères garantit que la première
 * passe couvre les envies qui comptent, au lieu de l'ordre alphabétique de la wishlist.
 */
export function prioritizeWishCards<T extends WishCardRef>(cards: readonly T[]): T[] {
  return [...cards].sort((a, b) => {
    const rarity =
      (RARITY_RANK[rarityCode(b.rarity)] ?? 0) - (RARITY_RANK[rarityCode(a.rarity)] ?? 0);
    if (rarity) return rarity;
    const median = (b.median ?? 0) - (a.median ?? 0);
    if (median) return median;
    return a.name.localeCompare(b.name, 'fr');
  });
}

/** Critères libres du panneau : ils restreignent les envies à interroger. */
export interface WishCardCriteria {
  text?: string;
  series?: string;
  rarity?: string;
}

/**
 * Code de rareté normalisé : le site a déjà renvoyé `S` (spéciale) là où le
 * reste de l'extension présente `L`, et le sélecteur du panneau ne propose que
 * `CURELM`.
 */
export function rarityCode(value: string | null | undefined): string {
  const code = (value ?? '').trim().toLocaleUpperCase();
  return code === 'S' ? 'L' : code;
}

const fold = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase();

/**
 * Vrai quand la carte répond aux critères saisis. En mode envies, le nom,
 * l'univers et la rareté ne sont pas envoyés à l'API (la requête porte déjà le
 * nom de la carte) : ils choisissent les envies à interroger et réduisent donc
 * les annonces affichées.
 */
export function matchesWishCard(
  card: WishCardRef,
  criteria: WishCardCriteria = {},
): boolean {
  const text = criteria.text?.trim();
  if (text && !fold(card.name).includes(fold(text))) return false;
  const series = criteria.series?.trim();
  if (series && !fold(card.series ?? '').includes(fold(series))) return false;
  const rarity = criteria.rarity?.trim();
  if (rarity && rarityCode(card.rarity) !== rarityCode(rarity)) return false;
  return true;
}

/** Envies cherchées par passe : 20 requêtes espacées de 600 ms ≈ 12 s. */
export const WISH_CARDS_PER_PASS = 20;
/** Pages lues au plus pour une envie ; au-delà, le statut le signale. */
export const WISH_PAGES_PER_CARD = 3;
/** Annonces lues au plus pour une envie (3 × 48). */
export const WISH_CARD_MAX_LISTINGS = WISH_PAGES_PER_CARD * MARKET_PAGE_SIZE;

export interface CardSearchOptions extends DealFilters, WishCardCriteria {
  pageSize?: number;
  /** Ordre demandé au site pour chaque carte ; identique au mode texte. */
  sort?: MarketQuery['sort'];
  /** Restreint aux annonces achetables tout de suite. */
  buyNow?: boolean;
  /** Restreint aux cartes que je ne possède pas encore. */
  missing?: boolean;
  maxCards?: number;
  /** Pages lues au plus par carte (3 par défaut, 144 annonces). */
  pagesPerCard?: number;
  /** Index (1-based) de la première envie lue ; `pages + 1` prolonge une passe. */
  startPage?: number;
  /** Pause entre deux envies, injectable pour les tests. */
  wait?: (ms: number) => Promise<void>;
  /** Annulation : la lecture s'arrête entre deux envies et rend ce qu'elle a lu. */
  signal?: AbortSignal;
  /** Horloge injectable, pour la validité du cache par carte. */
  now?: () => number;
  /** Faux pour relire le site sans servir le cache (bouton « Actualiser »). */
  useCache?: boolean;
  /** Progression : nombre d'envies lues et total de la liste. */
  onCard?: (read: number, total: number) => void;
}

/**
 * Dernières lectures par envie : une passe qui prolonge la précédente ne repaie pas
 * les mêmes requêtes. Le cache vit en mémoire (10 min) et ne sert jamais au-delà.
 */
const cardCache = new Map<string, { at: number; listings: MarketListing[] }>();

/** Identifiant de portée par client API : deux contextes ne partagent pas leurs lectures. */
const apiScopes = new WeakMap<object, number>();
let scopeSequence = 0;

function scopeOf(api: object): number {
  const known = apiScopes.get(api);
  if (known !== undefined) return known;
  scopeSequence += 1;
  apiScopes.set(api, scopeSequence);
  return scopeSequence;
}

export function clearWishCardCache(): void {
  cardCache.clear();
}

export function wishCardCacheSize(): number {
  return cardCache.size;
}

function cardCacheKey(api: object, card: WishCardRef, options: CardSearchOptions): string {
  return [
    scopeOf(api),
    card.id,
    card.name.toLocaleLowerCase(),
    options.sort ?? '',
    options.buyNow ? 'b' : '',
    options.missing ? 'm' : '',
    Math.trunc(options.pagesPerCard ?? WISH_PAGES_PER_CARD),
    Math.trunc(options.pageSize ?? MARKET_PAGE_SIZE),
  ].join('|');
}

export interface CardSearchSummary {
  /** Envies lues (cumul des passes). */
  read: number;
  /** Envies nommées dans la liste. */
  total: number;
  /** Envies de la liste sans nom connu, donc incherchables. */
  skipped: number;
  /** Envies dont la requête a échoué ; elles n'annulent pas les autres. */
  failures: number;
  /** Envies qui ont encore des annonces au-delà des pages lues. */
  saturated: string[];
}

/**
 * Cherche chaque envie par son nom, une requête par carte, et ne garde que les
 * annonces de cette carte-là (une recherche par nom peut ramener un homonyme ou
 * une autre carte de la même série). Une envie en échec est comptée puis
 * ignorée : les autres restent lisibles. Le marché compte des dizaines de
 * milliers d'annonces, balayer les plus récentes ne trouverait presque jamais
 * une envie précise.
 */
export async function searchMarketCards(
  api: Api,
  cards: readonly WishCardRef[],
  options: CardSearchOptions = {},
): Promise<MarketSearchResult> {
  const pageSize = options.pageSize ?? MARKET_PAGE_SIZE;
  const maxCards = Math.max(1, options.maxCards ?? WISH_CARDS_PER_PASS);
  const start = Math.max(1, Math.trunc(options.startPage ?? 1));
  const wait = options.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const clock = options.now ?? Date.now;
  const cacheAllowed = options.useCache !== false;

  const named = new Map<number, WishCardRef>();
  for (const card of cards) {
    const name = card.name.trim();
    if (!name || named.has(card.id)) continue;
    named.set(card.id, { ...card, name });
  }
  const skipped = cards.length - named.size;
  const list = prioritizeWishCards(
    [...named.values()].filter((card) => matchesWishCard(card, options)),
  );
  const total = list.length;
  const slice = list.slice(start - 1, start - 1 + maxCards);
  const pagesPerCard = Math.max(1, Math.trunc(options.pagesPerCard ?? WISH_PAGES_PER_CARD));
  const found = new Map<string, MarketListing>();
  const saturated: string[] = [];
  let read = Math.min(start - 1, total);
  let failures = 0;
  let aborted = false;

  for (const [index, card] of slice.entries()) {
    if (options.signal?.aborted) {
      aborted = true;
      break;
    }
    // Lecture récente de cette envie : on la réutilise au lieu de repayer trois pages.
    const key = cardCacheKey(api, card, { ...options, pagesPerCard, pageSize });
    const cached = cacheAllowed && start === 1 ? cardCache.get(key) : undefined;
    if (cached && clock() - cached.at < WISH_CARD_CACHE_TTL_MS) {
      for (const listing of cached.listings) found.set(listing.id, listing);
      read = start + index;
      options.onCard?.(read, total);
      continue;
    }
    let seen = 0;
    let annonceTotal = 0;
    let complet = false;
    let failed = false;
    const cardListings: MarketListing[] = [];
    for (let page = 1; page <= pagesPerCard; page += 1) {
      let pageListings: MarketListing[];
      try {
        const result = await call(
          api,
          marketSearchPath(
            {
              text: card.name,
              sort: options.sort,
              buyNow: options.buyNow,
              missing: options.missing,
            },
            page,
            pageSize,
          ),
        );
        if (!result.ok) throw new Error(result.message);
        if (isRecord(result.data) && typeof result.data.total === 'number') {
          annonceTotal = Math.max(0, Math.trunc(result.data.total));
        }
        pageListings = normalizeListings(result.data);
      } catch {
        failures += 1;
        failed = true;
        break;
      }
      for (const listing of pageListings) {
        if (listing.characterId !== card.id) continue;
        found.set(listing.id, listing);
        cardListings.push(listing);
      }
      seen += pageListings.length;
      complet = pageListings.length < pageSize || (annonceTotal > 0 && seen >= annonceTotal);
      if (complet || page === pagesPerCard) break;
      await waitUnlessAbort(MARKET_PAGE_DELAY_MS, wait, options.signal);
      if (options.signal?.aborted) break;
    }
    // Ce qui reste au-delà des pages lues : à signaler dans le statut.
    if (!complet && !failed) saturated.push(card.name);
    if (start === 1 && !failed && !options.signal?.aborted) {
      cardCache.set(key, { at: clock(), listings: cardListings });
      if (cardCache.size > MARKET_KEPT_MAX) {
        const oldest = [...cardCache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        if (oldest) cardCache.delete(oldest[0]);
      }
    }
    read = start + index;
    options.onCard?.(read, total);
    if (index < slice.length - 1) {
      await waitUnlessAbort(MARKET_PAGE_DELAY_MS, wait, options.signal);
      if (options.signal?.aborted) aborted = true;
    }
  }

  const merged = rankDeals([...found.values()], options);
  const listings = keepBest(merged);
  return {
    listings,
    total: null,
    pages: read,
    complete: read >= total && !aborted,
    cards: { read, total, skipped, failures, saturated },
    aborted,
    dropped: merged.length - listings.length,
  };
}

/**
 * Lit les annonces page par page et s'arrête dès que le site annonce que tout est
 * lu. Une erreur d'API remonte au premier échec : l'appelant décide quoi afficher.
 */
export async function searchMarket(
  api: Api,
  query: MarketQuery = {},
  options: MarketSearchOptions = {},
): Promise<MarketSearchResult> {
  const pageSize = options.pageSize ?? MARKET_PAGE_SIZE;
  const maxPages = Math.max(1, options.maxPages ?? MARKET_MAX_PAGES);
  const start = Math.max(1, Math.trunc(options.startPage ?? 1));
  const wait = options.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const seen = new Set<string>();
  const listings: MarketListing[] = [];
  let total: number | null = null;
  let pages = 0;
  let aborted = false;

  for (let page = start; page < start + maxPages; page += 1) {
    if (options.signal?.aborted) {
      aborted = true;
      break;
    }
    const result = await call(api, marketSearchPath(query, page, pageSize));
    if (!result.ok) throw new Error(`Marché : ${result.message}`);
    const data = result.data;
    if (isRecord(data) && typeof data.total === 'number' && Number.isFinite(data.total)) {
      total = Math.max(0, Math.trunc(data.total));
    }
    const pageListings = normalizeListings(data);
    pages = page;
    const fresh = pageListings.filter((listing) => {
      if (seen.has(listing.id)) return false;
      seen.add(listing.id);
      return true;
    });
    listings.push(...fresh);
    // « Tout lire » ne fait plus grossir la mémoire sans fin : le haut de liste suffit.
    if (listings.length > MARKET_KEPT_MAX) {
      listings.splice(0, listings.length, ...keepBest(listings));
    }
    options.onPage?.(fresh, page, total);
    const done = !pageListings.length || (total !== null && seen.size >= total);
    if (done) break;
    if (page < start + maxPages - 1) {
      await waitUnlessAbort(MARKET_PAGE_DELAY_MS, wait, options.signal);
      if (options.signal?.aborted) {
        aborted = true;
        break;
      }
    }
  }

  // Les pages précédentes d'une lecture prolongée comptent dans la couverture.
  const scanned = (start - 1) * pageSize + seen.size;
  const ranked = rankDeals(listings, options);
  return {
    listings: ranked,
    total,
    pages,
    complete: total === null ? pages - start + 1 < maxPages : scanned >= total,
    scanned,
    aborted,
    dropped: Math.max(0, seen.size - ranked.length),
  };
}

/**
 * Prolonge une lecture partielle : les annonces déjà vues (dédoublonnées par
 * identifiant) et les nouvelles sont filtrées puis reclassées ensemble, pour que
 * la meilleure affaire reste en tête quel que soit l'ordre des pages.
 */
export function mergeSearchResults(
  previous: MarketSearchResult | null,
  next: MarketSearchResult,
  filters: DealFilters = {},
): MarketSearchResult {
  const byId = new Map<string, MarketListing>();
  for (const listing of previous?.listings ?? []) byId.set(listing.id, listing);
  for (const listing of next.listings) byId.set(listing.id, listing);
  const ranked = rankDeals([...byId.values()], filters);
  const listings = keepBest(ranked);
  return {
    listings,
    total: next.total ?? previous?.total ?? null,
    pages: next.pages,
    complete: next.complete,
    scanned: next.scanned ?? previous?.scanned ?? 0,
    aborted: next.aborted === true,
    dropped:
      (previous?.dropped ?? 0) + (next.dropped ?? 0) + Math.max(0, ranked.length - listings.length),
    cards: next.cards
      ? {
          ...next.cards,
          saturated: [...new Set([...(previous?.cards?.saturated ?? []), ...next.cards.saturated])],
        }
      : previous?.cards,
  };
}

/**
 * Estimation du temps restant d'une passe : le débit se mesure sur les pages lues
 * DANS cette passe. En prolongement (« Lire la suite »), les pages déjà lues avant
 * la passe ne comptent ni dans le débit ni dans le temps écoulé, sinon l'estimation
 * serait sous-estimée.
 */
export function estimatePassRemaining(options: {
  page: number;
  startPage: number;
  total: number | null;
  elapsedMs: number;
  pageSize?: number;
}): { scanned: number; remainingMs: number } {
  const pageSize = Math.max(1, Math.trunc(options.pageSize ?? MARKET_PAGE_SIZE));
  const start = Math.max(1, Math.trunc(options.startPage));
  const page = Math.max(start, Math.trunc(options.page));
  const passScanned = (page - start + 1) * pageSize;
  const before = (start - 1) * pageSize;
  const scanned =
    options.total === null
      ? before + passScanned
      : Math.min(Math.max(0, options.total), before + passScanned);
  const elapsed = Math.max(1, options.elapsedMs);
  const remainingMs =
    options.total !== null && options.total > scanned
      ? ((options.total - scanned) * elapsed) / passScanned
      : 0;
  return { scanned, remainingMs };
}
