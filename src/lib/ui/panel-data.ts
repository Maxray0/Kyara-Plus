import { AuthError, PassRequiredError, type ApiClient } from '../api';
import { readCircuit, type CircuitState } from '../circuit-breaker';
import { notifyExpiringListings } from '../alerts/portfolio';
import { buyOrdersItem } from '../doublons/buy-orders';
import {
  orderQueueItem,
  readOrderLimit,
  type QueuedOrder,
} from '../doublons/order-queue';
import { getSales } from '../doublons/sales';
import {
  dailyRecapAlert,
  dashboardCsv,
  dashboardDay,
  type DashboardDay,
} from '../doublons/dashboard';
import { loadAlerts } from '../alerts/store';
import { upsertAlerts } from '../alerts/store';
import { fetchMarketOrders, fetchMyOrders, type MyOrder } from '../doublons/my-orders';
import {
  activeRows,
  costByCard,
  profitSummary,
  soldRows,
  type ActiveListingRow,
  type ProfitSummary,
  type SoldRow,
} from '../doublons/my-listings';
import { recordTradeAlerts } from '../alerts/sources';
import {
  albumTotals,
  buildAlbums,
  showcaseText,
  type AlbumSummary,
  type AlbumTotals,
} from '../doublons/albums';
import { getCatalog } from '../catalog';
import { buildCandidates, type Candidate } from '../doublons/candidates';
import { listedCounts } from '../doublons/sell';
import {
} from '../doublons/advisor';
import { getMarket, sellPricesItem, type Listing } from '../doublons/market';
import { loadOwnedIds } from '../doublons/owned';
import { getSellSettings, type SellSettings } from '../doublons/settings';
import { getTradeSettings, type TradeSettings } from '../doublons/trade-settings';
import {
  evaluateTrades,
  fetchOwned,
  loadTradeBoard,
  noDealReason,
  type TradeBoard,
  type TradeDeal,
} from '../doublons/trades';
import {
  createLiveEstimate,
  fetchRenaissance,
  type LiveRenaissanceEstimate,
  type RenaissanceState,
} from '../doublons/renaissance';
import {
  advisePacks,
  normalizePacks,
  packAvailable,
  PACKS_MAX_POOLS,
  poolIds,
  type PackAdvice,
} from '../doublons/packs';
import { loadWishlist } from '../doublons/wishlist';
import { autoSellLogItem, autoSellStatusItem, type AutoSellStatus } from '../doublons/auto-sell';
import {
  getPackHistory,
  getPackHistoryTotals,
  rarityRank,
  type PackHistoryEntry,
} from '../auto-open/history';
import { getWriteLog, writeLogSummary, type WriteLogEntry, type WriteLogSummary } from '../write-log';
import { autoOpenLogItem, autoOpenStatusItem, packCatalogItem } from '../auto-open/storage';
import type { AutoOpenStatus } from '../auto-open/runner';
import {
  loadUpdateCheck,
  storeLinks,
  type StoreLink,
  type UpdateCheck,
} from '../update-check';
import {
  budgetLabel,
  budgetSettingsItem,
  budgetStatsItem,
  normalizeBudget,
  type BudgetSettings,
} from '../automation/budget';
import { getSettings, type Settings } from '../settings';
import {
  getActivity,
  loadActivitySnapshot,
  refreshActivitySnapshot,
  type ActivityEntry,
} from '../doublons/activity';
import type { SalesSummary } from '../doublons/sales';
import {
  ensureSelf,
  importFriends,
  loadProfile,
  syncAccounts,
  type ProfileView,
} from '../stats/board';
import { fetchFriendList } from '../stats/remote';
import { record, type StatData, type CatalogCard } from '../stats/model';
import { loadStats, saveStats } from '../stats/store';

export type PanelApi = Pick<ApiClient, 'request'>;

function catalogMeta(catalog: readonly CatalogCard[]): Map<number, CatalogCard> {
  const meta = new Map<number, CatalogCard>();
  for (const card of catalog) {
    const id = Number(card.id);
    if (Number.isSafeInteger(id)) meta.set(id, card);
  }
  return meta;
}

function cardName(meta: ReadonlyMap<number, CatalogCard>, id: number): string {
  return meta.get(id)?.name ?? `Carte #${id}`;
}

export interface PanelSaleData {
  active: number;
  maxSlots: number;
  free: number;
  duplicates: number;
  sellable: number;
  /** Candidats vendables (remplissage groupé), sans les cartes bloquées. */
  candidates: readonly Candidate[];
  /** Tous les doublons, y compris bloqués : liste complète paginée du panneau. */
  allCandidates: readonly Candidate[];
  /** Annonces en cours, pour les ajuster ou les annuler sans quitter la page. */
  listings: readonly Listing[];
  settings: SellSettings;
  /** Vente automatique : état partagé et derniers messages, sans relire Kyara. */
  autoSell: {
    enabled: boolean;
    status: AutoSellStatus | null;
    log: readonly { t: number; m: string }[];
  };
}

/** Collection + annonces + prix mémorisés : aucun prix n'est inventé dans le panneau. */
export async function loadSalePanel(api: PanelApi): Promise<PanelSaleData> {
  const [settings, catalog, market, stored, appSettings, autoSellStatus, autoSellLog] =
    await Promise.all([
      getSellSettings(),
      getCatalog(api),
      getMarket(api),
      sellPricesItem.getValue(),
      getSettings(),
      autoSellStatusItem.getValue(),
      autoSellLogItem.getValue(),
    ]);
  const meta = catalogMeta(catalog);
  const candidates = await buildCandidates(api, settings, {
    activeIds: new Set(market.active.map((listing) => listing.characterId)),
    listed: listedCounts(market.active),
    holds: market.holds,
    meta,
    prices: new Map(Object.entries(stored).map(([id, value]) => [Number(id), value] as const)),
  });
  const sellable = candidates.filter((candidate) => !candidate.blocked && candidate.sellable > 0);
  sellable.forEach((candidate) => {
    candidate.checked = true;
  });
  // Une annonce proche de sa fin devient une alerte locale (aucune écriture de jeu).
  void notifyExpiringListings(market.active);
  return {
    active: market.active.length,
    maxSlots: settings.maxSlots,
    free: Math.max(0, settings.maxSlots - market.active.length),
    duplicates: candidates.length,
    sellable: sellable.length,
    candidates: sellable,
    allCandidates: candidates,
    listings: market.active,
    settings,
    autoSell: {
      enabled: appSettings.autoSell,
      status: autoSellStatus,
      log: autoSellLog.slice(-5).reverse(),
    },
  };
}

export interface PanelDashboardData {
  day: DashboardDay;
  /** CSV du jour prêt à télécharger. */
  csv: string;
}

/** Tableau de bord du jour : tout en lecture, plus un résumé quotidien dans la cloche. */
export async function loadDashboardPanel(
  api: PanelApi,
  now = Date.now(),
): Promise<PanelDashboardData> {
  const [sales, market, alerts, orders, open] = await Promise.all([
    getSales(now),
    getMarket(api),
    loadAlerts(now),
    buyOrdersItem.getValue(),
    fetchMarketOrders(api),
  ]);
  const input = {
    sales,
    orders: orders.entries,
    openOrders: open.open,
    listings: market.active,
    alerts,
    now,
  };
  const day = dashboardDay(input);
  const recap = dailyRecapAlert(day, now);
  // La clé du jour déduplique le résumé : une seule alerte par journée.
  if (recap) await upsertAlerts([recap], now).catch(() => undefined);
  return { day, csv: dashboardCsv(input, day) };
}

export interface PanelListingsData {
  /** Annonces encore actives, triées par fin la plus proche. */
  active: readonly ActiveListingRow[];
  /** Ventes terminées les plus récentes, bénéfice quand le coût est connu. */
  sold: readonly SoldRow[];
  summary: ProfitSummary;
  /** Nombre total de ventes conservées. */
  total: number;
  settings: SellSettings;
}

/** Annonces actives + ventes terminées (lecture seule, le marché enregistre les ventes). */
export async function loadListingsPanel(
  api: PanelApi,
  now = Date.now(),
): Promise<PanelListingsData> {
  const [settings, market, sales, orders] = await Promise.all([
    getSellSettings(),
    getMarket(api),
    getSales(now),
    buyOrdersItem.getValue(),
  ]);
  const rows = soldRows(sales, costByCard(orders.entries));
  return {
    active: activeRows(market.active, now),
    sold: rows,
    summary: profitSummary(rows),
    total: sales.length,
    settings,
  };
}

export interface TradeCandidate {
  offerId: string;
  leftId: number;
  giveId: number;
  leftName: string;
  giveName: string;
  giveN: number;
  gain: number;
  up: boolean;
}

export interface PanelTradeOffer {
  leftId: number;
  leftName: string;
  userPseudo: string;
  wantNames: readonly string[];
  /** Renseigné seulement quand l'offre passe les réglages. */
  deal: TradeCandidate | null;
  reason: string;
}

export interface PanelTradeEvaluation {
  deals: number;
  top: readonly TradeCandidate[];
  all: readonly PanelTradeOffer[];
}

export interface PanelTradeData extends PanelTradeEvaluation {
  settings: TradeSettings;
  /** Recalcule localement les offres avec d'autres réglages, sans relire Kyara. */
  reevaluate: (settings: TradeSettings) => PanelTradeEvaluation;
}

function tradeCandidate(
  deal: TradeBoard['deals'][number],
  meta: ReadonlyMap<number, CatalogCard>,
): TradeCandidate {
  return {
    offerId: deal.offerId,
    leftId: deal.leftId,
    giveId: deal.giveId,
    leftName: cardName(meta, deal.leftId),
    giveName: cardName(meta, deal.giveId),
    giveN: deal.n,
    gain: deal.gain,
    up: deal.up,
  };
}

function tradeDeals(
  board: TradeBoard,
  catalog: readonly CatalogCard[],
  settings: TradeSettings,
  now: number,
): TradeDeal[] {
  const rarity = new Map<number, string>();
  for (const card of catalog) {
    const id = Number(card.id);
    if (!Number.isSafeInteger(id)) continue;
    const value = String(card.rarity).toUpperCase();
    rarity.set(id, value === 'S' ? 'L' : value);
  }
  return evaluateTrades(board.offers, {
    owned: board.cards.owned,
    blocked: board.cards.blocked,
    fair: board.fair,
    rarity: (id) => rarity.get(id) ?? '',
    settings,
    myId: board.myId,
    now,
  });
}

/** Réévalue les mêmes offres avec de nouveaux réglages, sans requête ni nouvelle collection. */
export function evaluateTradePanel(
  board: TradeBoard,
  catalog: readonly CatalogCard[],
  settings: TradeSettings,
  now = Date.now(),
): PanelTradeEvaluation {
  const meta = catalogMeta(catalog);
  const dealsList = tradeDeals(board, catalog, settings, now);
  const deals = new Map(dealsList.map((deal) => [deal.offerId, deal]));
  return {
    deals: dealsList.length,
    top: dealsList.slice(0, 6).map((deal) => tradeCandidate(deal, meta)),
    all: board.offers.map((offer) => {
      const deal = deals.get(offer.id);
      return {
        leftId: offer.characterId,
        leftName: cardName(meta, offer.characterId),
        userPseudo: offer.userPseudo ?? 'Joueur',
        wantNames: offer.wantIds.map((id) => cardName(meta, id)),
        deal: deal ? tradeCandidate(deal, meta) : null,
        reason: deal ? 'Bon échange' : noDealReason(board, offer, now),
      };
    }),
  };
}

/** Offres du comptoir et bons échanges évalués avec les réglages enregistrés. */
export async function loadTradePanel(api: PanelApi): Promise<PanelTradeData> {
  const [settings, catalog, wishlist] = await Promise.all([
    getTradeSettings(),
    getCatalog(api),
    // Une wishlist indisponible ne doit pas empêcher d'afficher le comptoir.
    loadWishlist(api).catch((): number[] => []),
  ]);
  // Charge aussi les prix des dernières copies : la réévaluation locale peut activer
  // « Autoriser à donner ma dernière copie » sans relire le comptoir. Les échanges
  // calculés avec ces réglages permissifs sont remplacés juste après.
  const board = await loadTradeBoard(api, { ...settings, tradeUseLast: true }, catalog);
  // Le comptoir a été chargé avec les dernières copies autorisées pour garder leurs prix.
  // Les alertes, elles, suivent les réglages réellement enregistrés.
  const actualDeals = tradeDeals(board, catalog, settings, Date.now());
  await recordTradeAlerts({ ...board, deals: actualDeals }, wishlist, catalog);
  return {
    ...evaluateTradePanel(board, catalog, settings),
    settings,
    reevaluate: (next) => evaluateTradePanel(board, catalog, next),
  };
}

export interface WishCard {
  id: number;
  name: string;
  rarity: string | null;
  series: string | null;
}

export interface PanelWishData {
  count: number;
  catalogSize: number;
  cards: readonly WishCard[];
  wishIds: readonly number[];
  /** Cartes déjà possédées : le site refuserait de les mettre en envie. */
  ownedIds: readonly number[];
  catalog: readonly CatalogCard[];
  /** Médianes déjà en cache, pour prioriser les envies de valeur. */
  medians: ReadonlyMap<number, number>;
}

/** Liste d'envies de l'API, enrichie avec le catalogue déjà en cache. */
export async function loadWishPanel(api: PanelApi): Promise<PanelWishData> {
  const [catalog, ids, owned, stored] = await Promise.all([
    getCatalog(api),
    loadWishlist(api),
    loadOwnedIds(api),
    sellPricesItem.getValue(),
  ]);
  const medians = new Map<number, number>();
  for (const [id, value] of Object.entries(stored)) {
    const median = value.data.median7d ?? value.data.median30d ?? null;
    if (median && median > 0) medians.set(Number(id), median);
  }
  const meta = catalogMeta(catalog);
  const cards = ids
    .map((id): WishCard => {
      const card = meta.get(id);
      return {
        id,
        name: card?.name ?? `Carte #${id}`,
        rarity: card?.rarity ?? null,
        series: card?.series ?? null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  return {
    count: ids.length,
    catalogSize: catalog.length,
    cards: cards.slice(0, 10),
    wishIds: ids,
    ownedIds: owned,
    catalog,
    medians,
  };
}

export interface PanelRenaissanceData {
  state: RenaissanceState;
  /** Estimation progressive : les conditions s'affichent avant elle. */
  estimate: LiveRenaissanceEstimate;
}

/**
 * Renaissance en lecture seule : les conditions du compte s'affichent tout de suite,
 * puis le coût des cartes manquantes arrive rareté par rareté. Aucune écriture.
 */
export async function loadRenaissancePanel(api: PanelApi): Promise<PanelRenaissanceData> {
  const state = await fetchRenaissance(api);
  return { state, estimate: createLiveEstimate(api, state.cardRequirements) };
}

export interface PanelAlbumsData {
  albums: readonly AlbumSummary[];
  totals: AlbumTotals;
  showcase: string;
  catalogSize: number;
  /** Catalogue et possession, pour ouvrir le détail d'un album sans relire Kyara. */
  catalog: readonly CatalogCard[];
  owned: ReadonlyMap<number, number>;
  wishIds: readonly number[];
}

/** Albums et vitrine : catalogue en cache + quantités de la collection, sans autre appel. */
export async function loadAlbumsPanel(api: PanelApi): Promise<PanelAlbumsData> {
  const [catalog, collection, wishIds] = await Promise.all([
    getCatalog(api),
    fetchOwned(api),
    loadWishlist(api).catch((): number[] => []),
  ]);
  const albums = buildAlbums(catalog, collection.owned);
  const totals = albumTotals(albums);
  return {
    albums,
    totals,
    showcase: showcaseText(albums, totals),
    catalogSize: catalog.length,
    catalog,
    owned: collection.owned,
    wishIds,
  };
}

export interface BuyCard {
  id: number;
  name: string;
  rarity: string;
  series: string;
}

export interface PanelBuyData {
  /** Cartes du catalogue absentes de la collection, prêtes pour un ordre d'achat. */
  missing: readonly BuyCard[];
  /** Ordres d'achat ouverts, relus sur Kyara. */
  orders: readonly MyOrder[];
  /** Limite d'ordres ouverts du compte (`marketLimits.buyOrders`). */
  ordersLimit: number;
  /** File locale d'ordres, au-delà des places libres du site. */
  queue: readonly QueuedOrder[];
  /** Cartes déjà possédées, pour ne pas les racheter. */
  ownedIds: ReadonlySet<number>;
}

/** Achat : cartes manquantes et ordres ouverts ; les annonces sont lues à la demande. */
export async function loadBuyPanel(api: PanelApi): Promise<PanelBuyData> {
  const [catalog, collection, orders, ordersLimit, queue] = await Promise.all([
    getCatalog(api),
    fetchOwned(api),
    fetchMyOrders(api).catch((): MyOrder[] => []),
    readOrderLimit(api),
    orderQueueItem.getValue().catch(() => null),
  ]);
  const missing: BuyCard[] = [];
  const seen = new Set<number>();
  for (const card of catalog) {
    const id = Number(card.id);
    if (!Number.isSafeInteger(id) || id < 1 || seen.has(id)) continue;
    if ((collection.owned.get(id) ?? 0) > 0) continue;
    seen.add(id);
    missing.push({
      id,
      name: card.name || `Carte #${id}`,
      rarity: String(card.rarity ?? '').toUpperCase(),
      series: String(card.series ?? ''),
    });
  }
  missing.sort(
    (a, b) => a.rarity.localeCompare(b.rarity) || a.name.localeCompare(b.name, 'fr'),
  );
  return {
    missing,
    orders,
    ordersLimit,
    queue: queue?.entries ?? [],
    ownedIds: new Set(
      [...collection.owned.entries()]
        .filter(([, qty]) => qty > 0)
        .map(([id]) => id),
    ),
  };
}

export interface PanelActivityData {
  entries: readonly ActivityEntry[];
  summary: SalesSummary;
}

/** Journal local et résumé des ventes, sans appel réseau. */
export async function loadActivityPanel(): Promise<PanelActivityData> {
  const [entries, snapshot] = await Promise.all([getActivity(), loadActivitySnapshot()]);
  return { entries, summary: snapshot.summary };
}

/** Relit le marché pour enregistrer les ventes terminées, puis le résumé local. */
export async function refreshActivityPanel(api: PanelApi): Promise<void> {
  await refreshActivitySnapshot(api);
}

export interface PanelStatsData {
  /** Instantané complet, pour afficher et trier le tableau comme la page Stats. */
  data: StatData;
}

/** Dernier instantané local des pages Stats : aucune donnée n'est recalculée ici. */
export async function loadStatsPanel(): Promise<PanelStatsData> {
  return { data: await loadStats() };
}

/**
 * Relit le compte connecté puis tous les comptes suivis, comme la page Statistiques, et
 * enregistre l'instantané. Aucun prix n'est estimé localement : les prix officiels sont
 * demandés par `syncAccounts`.
 */
export async function syncStatsPanel(
  api: PanelApi,
  onProgress?: (message: string) => void,
): Promise<void> {
  const catalog = await getCatalog(api);
  let data = await loadStats();
  onProgress?.('Lecture du compte connecté…');
  const me = record(await api.request('/api/me', { timeoutMs: 15_000 }));
  if (me.id !== undefined && me.id !== null) {
    data = ensureSelf(
      data,
      {
        id: String(me.id),
        pseudo: typeof me.pseudo === 'string' ? me.pseudo : null,
        avatar: typeof me.avatar === 'string' ? me.avatar : null,
      },
      Date.now(),
    );
    await saveStats(data);
  }
  const next = await syncAccounts(
    data,
    {
      api,
      catalog,
      now: Date.now,
      onProgress: (message) => onProgress?.(message),
    },
    new AbortController().signal,
  );
  await saveStats(next);
}

/** Profil public d'un joueur, avec la valeur exacte quand sa collection est lisible. */
export async function loadStatsProfile(api: PanelApi, id: string): Promise<ProfileView> {
  return loadProfile(api, id, await getCatalog(api));
}

/** Relit un seul compte suivi, sans relancer toute la synchronisation. */
export async function syncStatsAccount(api: PanelApi, id: string): Promise<void> {
  const [catalog, data] = await Promise.all([getCatalog(api), loadStats()]);
  const next = await syncAccounts(
    data,
    { api, catalog, now: Date.now },
    new AbortController().signal,
    [id],
  );
  await saveStats(next);
}

/** Importe les amis puis mesure les nouveaux comptes ; renvoie le bilan de l'import. */
export async function importStatsFriends(
  api: PanelApi,
  onProgress?: (message: string) => void,
): Promise<{ imported: number; ignored: number }> {
  const data = await loadStats();
  const friends = await fetchFriendList(api);
  const result = importFriends(data, friends, Date.now());
  await saveStats(result.data);
  if (result.imported) await syncStatsPanel(api, onProgress);
  return { imported: result.imported, ignored: result.ignored };
}


export interface PanelPacksData {
  /** Boosters chiffrés, du meilleur prix par carte nouvelle au moins bon. */
  rows: PackAdvice[];
  /** Boosters vendus connus. */
  packs: number;
  /** Pools relus. */
  poolsRead: number;
  /** Pools en échec, comptés sans bloquer les autres. */
  failed: number;
}

/** Pause entre deux pools : le site limite les rafales. */
const PACK_POOL_DELAY_MS = 250;

/**
 * Conseil boosters en lecture seule : prix du booster, pool de cartes, cartes manquantes
 * et coût par carte nouvelle. Aucune ouverture n'est déclenchée.
 */
export async function loadPacksPanel(api: PanelApi): Promise<PanelPacksData> {
  const [collection, raw, catalog] = await Promise.all([
    fetchOwned(api),
    api.request<unknown>('/api/packs'),
    getCatalog(api).catch(() => []),
  ]);
  const packs = normalizePacks(raw).filter((pack) => packAvailable(pack));
  const targets = [...packs]
    .sort((a, b) => Number(b.free) - Number(a.free) || a.price - b.price)
    .slice(0, PACKS_MAX_POOLS);
  const pools = new Map<string, number[]>();
  let failed = 0;
  for (const [index, pack] of targets.entries()) {
    if (index > 0) await new Promise((resolve) => setTimeout(resolve, PACK_POOL_DELAY_MS));
    try {
      const pool = await api.request<unknown>(
        `/api/packs/${encodeURIComponent(pack.id)}/characters`,
      );
      pools.set(pack.id, poolIds(pool));
    } catch (error) {
      if (error instanceof AuthError || error instanceof PassRequiredError) throw error;
      failed += 1;
    }
  }
  const rarityOf = new Map<number, string>();
  for (const card of catalog) {
    const id = Number(card.id);
    if (Number.isSafeInteger(id) && id > 0 && card.rarity) {
      rarityOf.set(id, String(card.rarity).toUpperCase());
    }
  }
  // Un pool entier est déjà possédé : inutile de proposer le booster.
  const rows = advisePacks(packs, pools, collection.owned, { rarityOf }).filter(
    (row) => row.missing > 0,
  );
  return { rows, packs: packs.length, poolsRead: pools.size, failed };
}

export interface PanelSettingsData {
  settings: Settings;
  /** Cause du dernier déclenchement automatique du coupe-circuit. */
  circuit: CircuitState;
  /** Boosters proposés à l'ouverture automatique, sans les dons seuls. */
  packs: readonly { id: string; name: string }[];
  budget: BudgetSettings;
  budgetLabelText: string;
  autoOpen: { status: AutoOpenStatus | null; log: readonly { t: number; m: string }[] };
  autoSell: {
    status: AutoSellStatus | null;
    log: readonly { t: number; m: string; k: string }[];
  };
  version: string;
  update: UpdateCheck;
  links: readonly StoreLink[];
}

/**
 * Réglages des automatisations, repris du popup de la barre d'outils : tout vient du
 * stockage local (options, budget, journaux), sans requête à Kyara.
 */
export async function loadSettingsPanel(): Promise<PanelSettingsData> {
  const [settings, circuit, packs, budgetRaw, budgetStats, openStatus, openLog, sellStatus, sellLog] =
    await Promise.all([
      getSettings(),
      readCircuit(),
      packCatalogItem.getValue(),
      budgetSettingsItem.getValue(),
      budgetStatsItem.getValue(),
      autoOpenStatusItem.getValue(),
      autoOpenLogItem.getValue(),
      autoSellStatusItem.getValue(),
      autoSellLogItem.getValue(),
    ]);
  const runtime = browser.runtime as unknown as {
    requestUpdateCheck?: () => Promise<{ status?: string; details?: { version?: string } }>;
  };
  return {
    settings,
    circuit,
    packs: packs
      .filter((pack) => !pack.grantOnly)
      .map((pack) => ({ id: pack.id, name: pack.name })),
    budget: normalizeBudget(budgetRaw),
    budgetLabelText: budgetLabel(budgetStats),
    autoOpen: { status: openStatus, log: openLog.slice(-5).reverse() },
    autoSell: { status: sellStatus, log: sellLog.slice(-5).reverse() },
    version: browser.runtime.getManifest().version,
    update: await loadUpdateCheck(runtime),
    links: storeLinks(),
  };
}

export interface PanelPackHistoryData {
  /** Ouvertures, de la plus ancienne à la plus récente. */
  entries: readonly PackHistoryEntry[];
  /** Cumul à vie : le journal est plafonné, ces compteurs ne le sont pas. */
  totals: { opened: number; cards: number };
  /** Toutes les cartes obtenues, cumulées depuis la première ouverture. */
  cards: readonly PanelPackHistoryCard[];
}

export interface PanelPackHistoryCard {
  name: string;
  rarity: string | null;
  id: number | null;
  count: number;
  lastAt: number;
  packName: string;
  /** Visuelle du site : l'id de la carte suffit, sinon le catalogue donne l'image. */
  image: string | null;
}

/**
 * Historique des boosters ouverts : le journal conservé, les totaux à vie et le cumul par
 * carte. Le catalogue est relu (ou rafraîchi au-delà de 24 h) car les cartes obtenues avant
 * l'ajout des ids n'ont que leur nom pour retrouver leur visuelle.
 */
export async function loadPackHistoryPanel(api: PanelApi): Promise<PanelPackHistoryData> {
  const [entries, totals, catalog] = await Promise.all([
    getPackHistory(),
    getPackHistoryTotals(),
    // getCatalog relit le catalogue au-delà de 24 h et retourne son cache en cas d'échec :
    // c'est lui qui fournit l'id des cartes obtenues avant l'ajout des ids.
    getCatalog(api).catch((): CatalogCard[] => []),
  ]);
  const images = new Map<string, string>();
  for (const card of catalog) {
    if (!card.name) continue;
    // Comme le reste du panneau : la visuelle du site vient de l'id, jamais du portrait
    // AniList du catalogue (bloqué en hotlink). L'image du catalogue reste un repli.
    const id = Number(card.id);
    const image = Number.isSafeInteger(id) && id > 0 ? `/cards/sm/${id}.webp` : card.image;
    if (image) images.set(card.name.trim().toLowerCase(), image);
  }
  // L'id donne directement la visuelle du site ; sinon le catalogue la fournit par nom.
  const imageOf = (card: { id: number | null; name: string }): string | null =>
    (card.id ? `/cards/sm/${card.id}.webp` : null) ??
    images.get(card.name.trim().toLowerCase()) ??
    null;
  const cards = totals.byCard
    .map((card) => ({ ...card, image: imageOf(card) }))
    .sort(
      (a, b) =>
        rarityRank(a.rarity) - rarityRank(b.rarity) ||
        b.lastAt - a.lastAt ||
        a.name.localeCompare(b.name, 'fr'),
    );
  return { entries, totals: { opened: totals.opened, cards: totals.cards }, cards };
}

export interface PanelWriteLogData {
  /** Écritures, de la plus ancienne à la plus récente. */
  entries: readonly WriteLogEntry[];
  summary: WriteLogSummary;
}

/** Journal local des écritures de jeu, sans lecture réseau. */
export async function loadWriteLogPanel(now = Date.now()): Promise<PanelWriteLogData> {
  const entries = await getWriteLog();
  return { entries, summary: writeLogSummary(entries, now) };
}
