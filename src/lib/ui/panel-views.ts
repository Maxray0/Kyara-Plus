import { ApiError, AuthError, PassRequiredError, type ApiClient } from '../api';
import { fmt, h, imageUrl, type Child } from '../dom';
import type { Candidate } from '../doublons/candidates';
import collectionCss from './collection-panel.css?inline';
import {
  closeOtherSecondaryPanels,
  registerSecondaryPanel,
  unregisterSecondaryPanel,
} from './secondary-panel';
import { openCollectionPanel } from './collection-panel';
import { activityItem, appendActivity } from '../doublons/activity';
import { fetchPriceSnapshot, minPrice } from '../doublons/advisor';
import { gameActions } from '../doublons/actions';
import { fetchFairPrices } from '../doublons/market';
import {
  estimatePassRemaining,
  formatEndsIn,
  listingDiscount,
  MARKET_MAX_PAGES,
  MARKET_PAGE_SIZE,
  mergeSearchResults,
  rarityCode,
  searchMarket,
  searchMarketCards,
  WISH_CARD_MAX_LISTINGS,
  prioritizeWishCards,
  type MarketListing,
  type MarketSearchResult,
  type WishCardRef,
} from '../doublons/market-search';
import {
  MARKET_WATCH_INTERVALS_MIN,
  MARKET_WATCH_MAX,
  loadWatchBook,
  newWatch,
  patchWatch,
  removeWatch,
  runMarketWatchBook,
  saveWatchBook,
  type MarketWatchBook,
  type MarketWatchConfig,
} from '../doublons/market-watch';
import {
  EMPTY_MARKET_PREFS,
  loadMarketPrefs,
  resumePage,
  saveMarketPrefs,
  type MarketSearchPrefs,
} from '../doublons/market-prefs';
import {
  normalizeOpportunities,
  opportunitySummary,
  opportunitiesItem,
  recordOpportunity,
  wishesCsv,
  type OpportunityRecord,
} from '../doublons/opportunities';
import { rememberOwned } from '../doublons/owned';
import { buyPlanItem, dayStart, normalizeBuyPlan, type BuyPlan } from '../doublons/buy-plan';
import {
  BUY_ORDER_QTY_MAX,
  buyOrdersItem,
  checkOrder,
  normalizeBuyOrders,
  orderRecap,
  ordersSpentToday,
  placeBuyOrder,
  placeBuyOrders,
  type BuyOrderDraft,
  type BuyOrderEntry,
} from '../doublons/buy-orders';
import {
  enqueueOrders,
  moveQueuedOrder,
  orderQueueItem,
  processOrderQueue,
  queueWarnings,
  queuedTotal,
  removeQueuedOrders,
  sortQueueByMargin,
} from '../doublons/order-queue';
import {
  addPurchase,
  confirmWonAuctions,
  daySpend,
  normalizePurchases,
  purchasesItem,
  spendProblem,
  type DaySpend,
} from '../doublons/spend';
import { historyCsv, historyCsvName, historySummary, historyRows } from '../doublons/export';
import { syncOrderAlerts } from '../alerts/portfolio';
import { openPack } from '../doublons/pack-open';
import {
  backupJson,
  backupSummary,
  clearCaches,
  exportBackup,
  parseBackup,
  restoreBackup,
  type Backup,
} from '../doublons/backup';
import {
  autoBuyDecision,
  buyAutoSentItem,
  buyAutoSettingsItem,
  normalizeBuyAutoSettings,
  pruneSent,
  type BuyAutoDecision,
} from '../doublons/buy-auto';
import {
  cancelBuyOrder,
  ordersValue,
  remainingQty,
  type MyOrder,
} from '../doublons/my-orders';
import { withExcludedId } from '../doublons/protection';
import {
  REPRICE_INTERVALS_MIN,
  normalizeRepriceSettings,
  normalizeRepriceState,
  repriceBudget,
  repriceSettingsItem,
  repriceStateItem,
  runReprice,
  type RepriceSettings,
  type RepriceState,
} from '../doublons/reprice-watch';
import { fillSelection, listedCounts } from '../doublons/sell';
import { scanDeals } from '../doublons/deals';
import {
  bestBuyBid,
  bidListing,
  bidListings,
  buyListing,
  buyListings,
  snipeDelay,
} from '../doublons/buy-market';
import {
  albumCards,
  rewardAlbum,
  sortAlbums,
  type AlbumCard,
  type AlbumSort,
} from '../doublons/albums';
import {
  AUTO_RARITIES,
  PRESETS,
  normalizeSellSettings,
  sellSettingsItem,
  type SellSettings,
} from '../doublons/settings';
import {
  floorCost,
  type LiveRenaissanceEstimate,
  type RarityCost,
} from '../doublons/renaissance';
import { salesItem } from '../doublons/sales';
import { TradeRefresh } from '../doublons/trade-refresh';
import {
  normalizeTradeSettings,
  tradeSettingsItem,
  type TradeSettings,
} from '../doublons/trade-settings';
import { clearWishes } from '../doublons/wishlist';
import {
  appendPackHistory,
  packHistoryItem,
  rarityRank,
  type PackHistoryCard,
  type PackHistoryEntry,
} from '../auto-open/history';
import { normalizePacks as normalizeAutoOpenPacks } from '../auto-open/planner';
import { packCatalogItem } from '../auto-open/storage';
import { updateLabel } from '../update-check';
import { budgetSettingsItem, normalizeBudget, type BudgetSettings } from '../automation/budget';
import { setSetting } from '../settings';
import { normalizeCircuit, resetCircuit } from '../circuit-breaker';
import { writeLogItem, writeLogLine, type WriteLogEntry } from '../write-log';
import { addAccount, removeAccount } from '../stats/board';
import {
  STAT_COLUMNS,
  STAT_MAX_ACCOUNTS,
  columnOf,
  sortAccounts,
  type Account,
  type ColumnKey,
  type StatData,
} from '../stats/model';
import { searchLadder, searchPlayers, type PlayerHit } from '../stats/remote';
import { saveStats } from '../stats/store';
import { PANEL_VISIBILITY_EVENT, type PanelView } from './panel';
import {
  importStatsFriends,
  loadActivityPanel,
  loadAlbumsPanel,
  loadDashboardPanel,
  loadListingsPanel,
  loadPacksPanel,
  loadRenaissancePanel,
  loadPackHistoryPanel,
  loadWriteLogPanel,
  loadSalePanel,
  loadSettingsPanel,
  loadStatsProfile,
  loadStatsPanel,
  loadTradePanel,
  loadWishPanel,
  refreshActivityPanel,
  syncStatsAccount,
  syncStatsPanel,
  type PanelActivityData,
  type PanelAlbumsData,
  type PanelBuyData,
  loadBuyPanel,
  type PanelDashboardData,
  type PanelListingsData,
  type PanelPackHistoryData,
  type PanelPackHistoryCard,
  type PanelPacksData,
  type PanelRenaissanceData,
  type PanelSaleData,
  type PanelSettingsData,
  type PanelStatsData,
  type PanelWriteLogData,
  type PanelTradeData,
  type PanelWishData,
} from './panel-data';

type PanelApi = Pick<ApiClient, 'request'>;

interface ViewContext {
  api: PanelApi;
  /** Exécute une écriture puis relit la vue ; le libellé est affiché pendant l'attente. */
  perform: (label: string, task: () => Promise<string | void>) => Promise<void>;
  /** Enregistre un réglage sans reconstruire ni relire la vue affichée. */
  saveSettings: (label: string, task: () => Promise<string | void>) => Promise<void>;
  setStatus: (message: string) => void;
  /** Relit la vue après une écriture, quand elle dépend de données serveur. */
  reload?: () => Promise<boolean>;
  /** Nettoyage exécuté quand la vue est quittée ou reconstruite. */
  onCleanup: (fn: () => void) => void;
}

interface AsyncViewOptions<T> {
  id: string;
  label: string;
  eyebrow: string;
  title: string;
  lead: string;
  api: PanelApi;
  load: () => Promise<T>;
  render: (data: T, context: ViewContext) => HTMLElement;
  /** Branche les mises à jour de la vue ; le retour est appelé au changement d'onglet. */
  watch?: (
    data: T,
    refresh: () => Promise<boolean>,
    isActive: () => boolean,
    lastRefreshAt: () => number,
  ) => (() => void) | void;
}

interface WishSearchState {
  query: string;
  /** Recherche dans tout le marché : critères, dernière lecture et état. */
  market: MarketFilters;
  result: MarketSearchResult | null;
  error: string | null;
  busy: boolean;
  /** Envies lues et total, pendant une recherche envie par envie. */
  progress: { read: number; total: number } | null;
  /** Lignes de résultat visibles, augmentées par « Afficher plus ». */
  marketShown: number;
  /** Cartes possédées : le site refuse de les mettre en envie (`wish_owned`). */
  owned: Set<number>;
  /** Page de reprise d'une lecture partielle (recherche mémorisée). */
  startPage: number;
  /** Message d'ouverture : envies et catalogue lus, reprise éventuelle. */
  opening: string;
  /** Dernière lecture arrêtée par l'utilisateur. */
  aborted: boolean;
}

interface MarketFilters {
  text: string;
  series: string;
  rarity: string;
  /** Ordre demandé au site : plus récentes ou fin imminente. */
  sort: 'newest' | 'ending';
  wishOnly: boolean;
  noAuction: boolean;
  /** Cartes que je ne possède pas encore (`missing=1`). */
  missing: boolean;
  /** Annonces achetables tout de suite (`buyNow=1`). */
  buyNow: boolean;
  /** Masque les lignes des cartes déjà possédées. */
  hideOwned: boolean;
  minDiscount: number;
}

interface SettingsBoxState {
  open: boolean;
}

interface StatsSearchState {
  query: string;
  results: PlayerHit[] | null;
}

function explainPanelError(error: unknown): string {
  if (error instanceof AuthError) {
    return 'Session expirée : ouvre kyara.games, reconnecte-toi, puis actualise.';
  }
  if (error instanceof PassRequiredError) {
    return 'Kyara demande une vérification sur le site. Effectue-la sur kyara.games, puis actualise.';
  }
  return error instanceof Error ? error.message : 'Action impossible pour le moment.';
}

function atLabel(at: number): string {
  if (!at) return 'jamais actualisé';
  return new Date(at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

/**
 * Les vues sont construites avant l'ouverture du tiroir. On attend donc son premier
 * affichage pour lancer les lectures, sans requête API à chaque chargement de Kyara.
 */
function startWhenOpen(root: HTMLElement, start: () => void): () => void {
  let observer: MutationObserver | null = null;
  let stopped = false;
  queueMicrotask(() => {
    if (stopped) return;
    const node = root.getRootNode();
    const host = node instanceof ShadowRoot ? node.host : null;
    if (!host || host.classList.contains('is-open')) {
      start();
      return;
    }
    observer = new MutationObserver(() => {
      if (!host.classList.contains('is-open')) return;
      observer?.disconnect();
      observer = null;
      start();
    });
    observer.observe(host, { attributes: true, attributeFilter: ['class'] });
  });
  return () => {
    stopped = true;
    observer?.disconnect();
    observer = null;
  };
}

/** Le panneau reste monté quand il est fermé : l'activité ne doit pas travailler à vide. */
function panelIsActive(root: HTMLElement): boolean {
  if (!root.isConnected || document.visibilityState !== 'visible') return false;
  const node = root.getRootNode();
  return node instanceof ShadowRoot && node.host.classList.contains('is-open');
}

function tradeWatch(
  data: PanelTradeData,
  refresh: () => Promise<boolean>,
  isActive: () => boolean,
  lastRefreshAt: () => number,
): () => void {
  const intervalFor = (minutes: number): number => (minutes > 0 ? minutes * 60_000 : 0);
  let intervalMs = intervalFor(data.settings.tradeRefreshMin);
  const timer = new TradeRefresh({ intervalMs, refresh, isActive });

  const stale = (): boolean => intervalMs > 0 && Date.now() - lastRefreshAt() >= intervalMs;
  const resume = (): void => {
    if (!isActive()) {
      timer.pause();
      return;
    }
    // Une pause courte reprend sur l'échéance restante ; une liste plus vieille que
    // l'intervalle est relue tout de suite.
    timer.start();
    if (stale()) void timer.refreshNow();
  };
  const onPanelVisibility = (event: Event): void => {
    if ((event as CustomEvent<boolean>).detail) resume();
    else timer.pause();
  };
  const onVisibilityChange = (): void => {
    if (document.visibilityState === 'visible') resume();
    else timer.pause();
  };
  document.addEventListener(PANEL_VISIBILITY_EVENT, onPanelVisibility);
  document.addEventListener('visibilitychange', onVisibilityChange);
  // Le réglage peut être modifié depuis la page Doublons ou le popup pendant que le
  // panneau est ouvert : l'intervalle suit immédiatement, sans redémarrer une lecture.
  const stopSettings = tradeSettingsItem.watch((value) => {
    const next = intervalFor(normalizeTradeSettings(value).tradeRefreshMin);
    if (next === intervalMs) return;
    intervalMs = next;
    timer.setInterval(next);
    if (next === 0) timer.stop();
    else resume();
  });
  resume();
  return () => {
    document.removeEventListener(PANEL_VISIBILITY_EVENT, onPanelVisibility);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    stopSettings();
    timer.stop();
  };
}

function metric(label: string, value: string): HTMLElement {
  return h(
    'div',
    { class: 'kui-metric' },
    h('span', { class: 'kui-metric-label' }, label),
    h('strong', {}, value),
  );
}

function metrics(entries: readonly [string, string][]): HTMLElement {
  return h(
    'div',
    { class: 'kui-metrics' },
    ...entries.map(([label, value]) => metric(label, value)),
  );
}

function cardThumb(id: number): HTMLElement | null {
  // Le visuel de carte du site vient toujours de l’id, jamais du portrait
  // AniList renvoyé par l’API (souvent bloqué en hotlink).
  const src = id > 0 ? imageUrl(`/cards/sm/${id}.webp`) : null;
  // Pas de lazy loading : la vue Vente est rendue avant l’ouverture du panneau
  // et Chrome peut alors ne jamais déclencher le chargement des miniatures.
  return src ? h('img', { class: 'kui-thumb', src, alt: '', width: '32', height: '48' }) : null;
}

function row(title: string, detail: string, chip?: Child, id = 0): HTMLElement {
  return h(
    'div',
    { class: 'kui-data-row' },
    cardThumb(id),
    h('div', { class: 'kui-row-main' }, h('b', {}, title), h('small', {}, detail)),
    chip ? h('span', { class: 'kui-chip' }, chip) : null,
  );
}

function actionRow(title: string, detail: string, action: HTMLElement, id = 0): HTMLElement {
  return h(
    'div',
    { class: 'kui-data-row kui-data-row-action' },
    cardThumb(id),
    h('div', { class: 'kui-row-main' }, h('b', {}, title), h('small', {}, detail)),
    action,
  );
}

function list(rows: readonly HTMLElement[]): HTMLElement {
  return h('div', { class: 'kui-rows' }, ...rows);
}

function valueOrDash(value: number | null): string {
  return value === null ? '—' : fmt(value);
}

function priceLabel(value: number | null): string {
  return value === null ? 'prix à estimer' : `${fmt(value)} ◆`;
}

/**
 * Une écriture de jeu exige deux vrais clics, comme dans les pages complètes. Un script
 * de la page ne peut donc pas déclencher une vente ou une acceptation via le shadow DOM.
 */
function guardedButton(
  label: string,
  armedLabel: string,
  action: () => void | Promise<void>,
): HTMLButtonElement {
  const button = h('button', { type: 'button', class: 'kui-action' }, label) as HTMLButtonElement;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const reset = () => {
    clearTimeout(timer);
    button.classList.remove('armed');
    button.textContent = label;
  };
  button.addEventListener('click', (event) => {
    if (!event.isTrusted || button.disabled) return;
    if (!button.classList.contains('armed')) {
      button.classList.add('armed');
      button.textContent = armedLabel;
      timer = setTimeout(reset, 4_000);
      return;
    }
    reset();
    void action();
  });
  return button;
}

function trustedButton(label: string, action: () => void | Promise<void>): HTMLButtonElement {
  const button = h(
    'button',
    { type: 'button', class: 'kui-secondary' },
    label,
  ) as HTMLButtonElement;
  button.addEventListener('click', (event) => {
    if (!event.isTrusted || button.disabled) return;
    void action();
  });
  return button;
}

function asyncView<T>(options: AsyncViewOptions<T>): PanelView {
  let cache: { value: T; at: number } | null = null;
  let pending: Promise<{ value: T; at: number }> | null = null;
  /** Nettoyage du rendu courant ; un retour sur l'onglet crée un nouveau rendu. */
  let cleanCurrent: (() => void) | null = null;

  function destroy(): void {
    cleanCurrent?.();
    cleanCurrent = null;
  }

  function load(force: boolean): Promise<{ value: T; at: number }> {
    if (pending) return pending;
    if (!force && cache) return Promise.resolve(cache);
    // Le cache est rempli par la requête elle-même : si la vue est quittée avant la
    // fin de la lecture, son résultat reste disponible au prochain rendu.
    const request = options
      .load()
      .then((value) => {
        cache = { value, at: Date.now() };
        return cache;
      })
      .catch((error: unknown) => {
        cache = null;
        throw error;
      })
      .finally(() => {
        pending = null;
      });
    pending = request;
    return request;
  }

  return {
    id: options.id,
    label: options.label,
    render: () => {
      // Un rendu neuf remplace les abonnements du précédent, même si l'appelant
      // oublie `destroy`.
      cleanCurrent?.();
      let disposed = false;
      // L'état d'attente est propre au rendu : un retour sur l'onglet pendant le
      // premier chargement doit pouvoir s'abonner au même `pending` et peindre le résultat.
      let loading = false;
      let acting = false;
      let lastRefreshAt = cache?.at ?? 0;
      let painted: { value: T; at: number } | null = null;
      let watching = false;
      let stopWatch: (() => void) | null = null;
      let stopStart: (() => void) | null = null;
      const teardowns = new Set<() => void>();

      const cleanup = (): void => {
        if (disposed) return;
        disposed = true;
        stopStart?.();
        stopStart = null;
        stopWatch?.();
        stopWatch = null;
        watching = false;
        for (const fn of teardowns) fn();
        teardowns.clear();
      };
      cleanCurrent = cleanup;

      const startWatch = (data: T, refresh: () => Promise<boolean>): void => {
        if (watching || disposed || !options.watch) return;
        watching = true;
        stopWatch =
          options.watch(
            data,
            refresh,
            () => panelIsActive(root),
            () => lastRefreshAt,
          ) ?? null;
      };

      const status = h('span', { class: 'kui-data-status', 'aria-live': 'polite' });
      const body = h('div', { class: 'kui-data-body' });
      const notice = h('p', { class: 'kui-action-feedback', hidden: true });
      const refresh = h(
        'button',
        { type: 'button', class: 'kui-refresh', title: 'Relire les données de Kyara' },
        'Actualiser',
      ) as HTMLButtonElement;

      const root = h(
        'div',
        { class: 'kui-view' },
        h('p', { class: 'kui-eyebrow' }, options.eyebrow),
        h('h2', {}, options.title),
        h('p', { class: 'kui-lead' }, options.lead),
        h('div', { class: 'kui-toolbar' }, status, refresh),
        notice,
        body,
      );

      const setBusy = (): void => {
        refresh.disabled = loading || acting;
        root.classList.toggle('is-busy', loading || acting);
      };

      const paint = (result: { value: T; at: number }): void => {
        body.replaceChildren(options.render(result.value, context));
        status.textContent = `Actualisé à ${atLabel(result.at)}`;
        lastRefreshAt = result.at;
        painted = result;
      };

      const run = async (
        force = false,
        loadingLabel = 'Lecture des données Kyara…',
      ): Promise<boolean> => {
        if (loading || disposed) return false;
        loading = true;
        setBusy();
        status.textContent = 'Lecture…';
        if (!cache) {
          body.replaceChildren(h('p', { class: 'kui-data-loading' }, loadingLabel));
        }
        try {
          const result = await load(force);
          if (disposed) return false;
          paint(result);
          startWatch(result.value, () => run(true));
          return true;
        } catch (error) {
          if (disposed) return false;
          // Une actualisation ratée ne doit pas réapparaître comme une ancienne vue valide
          // au prochain changement d'onglet.
          cache = null;
          status.textContent = 'Lecture impossible';
          body.replaceChildren(h('p', { class: 'kui-data-error' }, explainPanelError(error)));
          return false;
        } finally {
          loading = false;
          setBusy();
        }
      };

      const perform = async (label: string, task: () => Promise<string | void>): Promise<void> => {
        if (acting || loading) return;
        acting = true;
        notice.hidden = true;
        setBusy();
        status.textContent = label;
        try {
          const message = await task();
          if (message) {
            notice.textContent = message;
            notice.hidden = false;
          }
          // La relecture part d'une vue vide : les boutons de l'ancien état disparaissent
          // même si le chargement échoue, et le message de succès n'est pas masqué.
          cache = null;
          if (!(await run(true, 'Relecture après action…'))) {
            status.textContent = 'Action effectuée · actualisation impossible';
            return;
          }
          status.textContent = message || 'Action effectuée';
        } catch (error) {
          status.textContent = 'Action impossible';
          notice.textContent = explainPanelError(error);
          notice.hidden = false;
        } finally {
          acting = false;
          setBusy();
        }
      };

      const saveSettings = async (
        label: string,
        task: () => Promise<string | void>,
      ): Promise<void> => {
        if (acting || loading) return;
        acting = true;
        notice.hidden = true;
        setBusy();
        status.textContent = label;
        try {
          const message = await task();
          if (message) {
            notice.textContent = message;
            notice.hidden = false;
          }
          status.textContent = message || 'Réglages enregistrés.';
        } catch (error) {
          status.textContent = 'Enregistrement impossible';
          notice.textContent = explainPanelError(error);
          notice.hidden = false;
        } finally {
          acting = false;
          setBusy();
        }
      };

      const context: ViewContext = {
        api: options.api,
        perform,
        saveSettings,
        setStatus: (message) => {
          status.textContent = message;
        },
        reload: () => run(true),
        onCleanup: (fn) => {
          if (disposed) fn();
          else teardowns.add(fn);
        },
      };

      refresh.addEventListener('click', () => {
        if (loading || acting) return;
        notice.hidden = true;
        void run(true);
      });
      if (cache) paint(cache);
      // Une vue déjà chargée reste à jour sans requête avant la première ouverture.
      stopStart = startWhenOpen(root, () => {
        if (disposed) return;
        if (pending) {
          // Une lecture a survécu au rendu précédent : on s'y abonne au lieu de
          // réafficher un cache plus ancien.
          void run();
          return;
        }
        // La lecture a pu se terminer pendant que le panneau était fermé.
        if (cache && cache !== painted) paint(cache);
        if (cache) startWatch(cache.value, () => run(true));
        else void run();
      });
      return root;
    },
    destroy,
  };
}

function shortDate(value: string | null): string {
  if (!value) return 'sans date';
  const at = Date.parse(value);
  if (!Number.isFinite(at)) return 'date inconnue';
  return new Date(at).toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function settingsField(label: string, control: HTMLElement): HTMLElement {
  return h('label', { class: 'kui-field' }, h('span', {}, label), control);
}

function settingsBox(
  title: string,
  state: SettingsBoxState,
  ...children: Child[]
): HTMLDetailsElement {
  const box = h(
    'details',
    { class: 'kui-settings-box', open: state.open },
    h('summary', {}, title),
    ...children,
  ) as HTMLDetailsElement;
  box.addEventListener('toggle', () => {
    state.open = box.open;
  });
  return box;
}

function settingsSelect(
  value: string,
  options: readonly [string, string][],
  onChange: (value: string) => void,
): HTMLSelectElement {
  const select = h(
    'select',
    { class: 'kui-select' },
    ...options.map(([optionValue, label]) => h('option', { value: optionValue }, label)),
  ) as HTMLSelectElement;
  select.value = value;
  select.addEventListener('change', () => onChange(select.value));
  return select;
}

function settingsNumber(
  value: number,
  min: number,
  max: number,
  onChange: (value: number) => void,
): HTMLInputElement {
  const input = h('input', {
    type: 'number',
    class: 'kui-number-input',
    min: String(min),
    max: String(max),
    value: String(value),
  }) as HTMLInputElement;
  input.addEventListener('change', () => onChange(Number(input.value)));
  return input;
}

function dashboardContent(data: PanelDashboardData): HTMLElement {
  const day = data.day;
  const expiring = h('div', { class: 'kui-rows kui-dash-expiring' });
  if (!day.expiring.length) {
    expiring.append(h('p', { class: 'kui-note' }, 'Aucune annonce ne se termine dans les deux heures.'));
  }
  for (const listing of day.expiring) {
    expiring.append(
      h(
        'div',
        { class: 'kui-buy-row' },
        h(
          'div',
          { class: 'kui-row-main' },
          h('b', {}, listing.name ?? `Annonce ${listing.id}`),
          h('small', {}, `${fmt(listing.price)} ◆ · fin dans ${fmt(Math.max(1, Math.round(listing.leftMs / 60_000)))} min`),
        ),
      ),
    );
  }

  const opportunities = h('div', { class: 'kui-rows kui-dash-ops' });
  if (!day.opportunities.length) {
    opportunities.append(h('p', { class: 'kui-note' }, 'Aucune alerte de veille à reprendre aujourd’hui.'));
  }
  for (const alert of day.opportunities) {
    opportunities.append(
      h(
        'div',
        { class: 'kui-buy-row' },
        h(
          'div',
          { class: 'kui-row-main' },
          h('b', {}, alert.title),
          h('small', {}, alert.message),
        ),
        alert.href
          ? h(
              'div',
              { class: 'kui-buy-actions' },
              h('a', { href: alert.href, target: '_blank', rel: 'noreferrer', class: 'kui-action' }, 'Ouvrir'),
            )
          : null,
      ),
    );
  }

  const status = h('p', { class: 'kui-note kui-dash-status', role: 'status' }, '');
  const backupStatus = h('p', { class: 'kui-note kui-backup-status', role: 'status' }, '');
  const backupButton = h('button', { type: 'button', class: 'kui-action' }, 'Sauvegarder les réglages');
  backupButton.addEventListener('click', () => {
    void exportBackup()
      .then((backup) => {
        const url = URL.createObjectURL(
          new Blob([backupJson(backup)], { type: 'application/json' }),
        );
        h('a', { href: url, download: 'kyara-sauvegarde.json' }).click();
        URL.revokeObjectURL(url);
        backupStatus.textContent = `Sauvegarde prête · ${backupSummary(backup)}.`;
      })
      .catch(() => {
        backupStatus.textContent = 'Sauvegarde impossible dans ce contexte.';
      });
  });
  const backupFile = h('input', {
    type: 'file',
    accept: 'application/json,.json',
    class: 'kui-file-input',
  }) as HTMLInputElement;
  backupFile.hidden = true;
  let pendingBackup: Backup | null = null;
  const restore = guardedButton('Restaurer', 'Confirmer', async () => {
    if (!pendingBackup) {
      backupStatus.textContent = 'Choisis d’abord un fichier de sauvegarde valide.';
      return;
    }
    const keys = await restoreBackup(pendingBackup);
    backupStatus.textContent = `Restauration appliquée (${fmt(keys.length)} clé(s)) : rouvre la vue pour la relire.`;
    pendingBackup = null;
    restore.disabled = true;
  });
  restore.disabled = true;
  const importButton = h(
    'button',
    { type: 'button', class: 'kui-action' },
    'Choisir une sauvegarde',
  );
  importButton.addEventListener('click', () => backupFile.click());
  backupFile.addEventListener('change', () => {
    const file = backupFile.files?.[0];
    if (!file) return;
    void file
      .text()
      .then((text) => {
        const parsed = parseBackup(text);
        if (!parsed.ok) {
          pendingBackup = null;
          restore.disabled = true;
          backupStatus.textContent = parsed.error;
          return;
        }
        pendingBackup = parsed.backup;
        restore.disabled = false;
        backupStatus.textContent = `Fichier lu · ${backupSummary(parsed.backup)} : confirme la restauration.`;
      })
      .catch(() => {
        backupStatus.textContent = 'Fichier illisible.';
      });
  });
  /** Historique complet (ventes, ordres, achats), au-delà du seul CSV du jour. */
  const exportHistoryCsv = h(
    'button',
    { type: 'button', class: 'kui-action' },
    'Exporter ventes et ordres (CSV)',
  );
  exportHistoryCsv.addEventListener('click', () => {
    void (async () => {
      const [sales, orders, purchases] = await Promise.all([
        salesItem.getValue().catch(() => null),
        buyOrdersItem.getValue().catch(() => null),
        purchasesItem.getValue().catch(() => null),
      ]);
      const input = {
        sales: (sales?.entries ?? []) as Parameters<typeof historyCsv>[0]['sales'],
        orders: normalizeBuyOrders(orders).entries,
        purchases: normalizePurchases(purchases).entries,
      };
      const rows = historyRows(input);
      if (!rows.length) {
        status.textContent = 'Aucun historique à exporter pour le moment.';
        return;
      }
      try {
        const url = URL.createObjectURL(
          new Blob([`\uFEFF${historyCsv(input)}`], { type: 'text/csv;charset=utf-8' }),
        );
        h('a', { href: url, download: historyCsvName() }).click();
        URL.revokeObjectURL(url);
        status.textContent = `Historique exporté · ${historySummary(rows)}.`;
      } catch {
        status.textContent = 'Export impossible dans ce contexte.';
      }
    })();
  });

  /** Efface les caches de travail : le catalogue et les prix se relisent tout seuls. */
  const clearCacheButton = guardedButton('Vider les caches', 'Confirmer', async () => {
    const removed = await clearCaches();
    status.textContent = removed
      ? `${fmt(removed)} cache(s) vidé(s) : catalogue, prix, possession, envies, duplication, opportunités. Les prochaines lectures les reconstruiront.`
      : 'Aucun cache à vider.';
  });

  const exportCsv = h('button', { type: 'button', class: 'kui-action' }, 'Exporter le CSV du jour');
  exportCsv.addEventListener('click', () => {
    try {
      const blob = new Blob([data.csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = h('a', { href: url, download: 'kyara-jour.csv' });
      link.click();
      URL.revokeObjectURL(url);
      status.textContent = 'CSV du jour téléchargé.';
    } catch {
      status.textContent = 'Export impossible dans ce contexte.';
    }
  });

  return h(
    'div',
    { class: 'kui-dashboard' },
    metrics([
      ['Ventes du jour', `${fmt(day.sales.count)} · ${fmt(day.sales.proceeds)} ◆`],
      ['Ordres du jour', `${fmt(day.orders.count)} · ${fmt(day.orders.spent)} ◆`],
      ['Ordres ouverts', `${fmt(day.orders.open)} · ${fmt(day.orders.remainingValue)} ◆ engagés`],
      ['Annonces à 2 h', fmt(day.expiring.length)],
    ]),
    h('h3', { class: 'kui-section-title' }, 'Annonces bientôt terminées'),
    expiring,
    h('h3', { class: 'kui-section-title' }, 'Opportunités de la veille'),
    opportunities,
    h('h3', { class: 'kui-section-title' }, 'Export et sauvegarde'),
    h(
      'p',
      { class: 'kui-note' },
      'CSV du jour, ou sauvegarde JSON des réglages et caches locaux (aucun secret, aucune ' +
        'donnée de session). La restauration ne réécrit que les clés connues.',
    ),
    h(
      'div',
      { class: 'kui-buy-actions' },
      exportCsv,
      exportHistoryCsv,
      clearCacheButton,
      backupButton,
      importButton,
      restore,
    ),
    status,
    backupStatus,
    backupFile,
  );
}

function myListingsContent(data: PanelListingsData, context: ViewContext): HTMLElement {
  const activeBox = h('div', { class: 'kui-rows kui-listings' });
  if (!data.active.length) {
    activeBox.append(h('p', { class: 'kui-note' }, 'Aucune annonce active pour le moment.'));
  }
  for (const row of data.active) {
    const name = row.listing.name ?? `Carte #${row.listing.characterId}`;
    const ends = formatEndsIn(row.listing.endsAt) ?? 'fin inconnue';
    const auction = row.listing.type === 'auction';
    const relaunch = guardedButton('Relancer', 'Confirmer', () =>
      context.perform(`Relance de ${name}…`, async () => {
        const result = await gameActions.reprice(context.api, row.listing, row.listing.price, data.settings, {
          gapMs: 0,
          log: (message, kind) => void appendActivity(message, kind),
        });
        if (!result.listed) throw new Error(result.message);
        void appendActivity(
          `Annonce de ${name} relancée à ${fmt(result.price ?? row.listing.price)} ◆.`,
          'sale',
        );
        return result.message;
      }),
    );
    relaunch.disabled = auction;
    relaunch.title = auction
      ? 'Une enchère ne se relance pas ici'
      : 'Annule l’annonce et la remet en vente au même prix, pour la durée réglée';
    activeBox.append(
      h(
        'div',
        { class: 'kui-buy-row kui-listing-row' },
        cardThumb(row.listing.characterId),
        h(
          'div',
          { class: 'kui-row-main' },
          h('b', {}, name),
          h(
            'small',
            {},
            `${fmt(row.listing.price)} ◆ · ${ends}${row.soon ? ' · bientôt finie' : ''}${
              auction ? ' · enchère' : ''
            }`,
          ),
        ),
        h('div', { class: 'kui-buy-actions' }, relaunch),
      ),
    );
  }

  const soldBox = h('div', { class: 'kui-rows kui-sold' });
  if (!data.sold.length) {
    soldBox.append(h('p', { class: 'kui-note' }, 'Aucune vente terminée enregistrée.'));
  }
  for (const row of data.sold) {
    const name = row.sale.name ?? `Carte #${row.sale.cardId}`;
    const when = new Date(row.sale.at).toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
    });
    const profit =
      row.profit === null
        ? 'bénéfice inconnu (pas de prix d’achat)'
        : `bénéfice ${row.profit >= 0 ? '+' : ''}${fmt(row.profit)} ◆`;
    soldBox.append(
      h(
        'div',
        { class: 'kui-buy-row' },
        cardThumb(row.sale.cardId),
        h(
          'div',
          { class: 'kui-row-main' },
          h('b', {}, name),
          h('small', {}, `${fmt(row.sale.price)} ◆ · ${when} · ${profit}`),
        ),
      ),
    );
  }

  const bilan =
    `Encaissé ${fmt(data.summary.proceeds)} ◆ sur ${fmt(data.sold.length)} vente(s) affichée(s)` +
    (data.summary.matched
      ? ` · bénéfice connu ${data.summary.profit >= 0 ? '+' : ''}${fmt(data.summary.profit)} ◆`
      : '') +
    (data.summary.unknown ? ` · ${fmt(data.summary.unknown)} sans prix d’achat` : '') +
    (data.total > data.sold.length ? ` · ${fmt(data.total)} vente(s) en historique` : '');

  return h(
    'div',
    { class: 'kui-listings-view' },
    h('h3', { class: 'kui-section-title' }, 'Annonces en cours'),
    h(
      'p',
      { class: 'kui-note' },
      'Triées par fin la plus proche. « Relancer » annule l’annonce et la remet en vente au ' +
        'même prix, pour la durée réglée (deux vrais clics).',
    ),
    activeBox,
    h('h3', { class: 'kui-section-title' }, 'Ventes terminées'),
    h(
      'p',
      { class: 'kui-note' },
      'Bénéfice estimé avec le prix de ton dernier ordre d’achat sur la carte ; sans achat ' +
        'connu, il reste annoncé comme inconnu.',
    ),
    h('p', { class: 'kui-note kui-listing-summary', role: 'status' }, bilan),
    soldBox,
  );
}

function saleSettingsContent(
  data: PanelSaleData,
  context: ViewContext,
  state: SettingsBoxState,
): HTMLDetailsElement {
  const save = (patch: Partial<SellSettings>): void => {
    const next = normalizeSellSettings({ ...data.settings, ...patch });
    void context.saveSettings('Enregistrement des réglages…', async () => {
      await sellSettingsItem.setValue(next);
      // La vue garde ses données : seuls les réglages utilisés par les actions changent.
      data.settings = next;
      return 'Réglages de vente enregistrés.';
    });
  };
  const exclude = h('input', {
    type: 'text',
    class: 'kui-search-input',
    value: data.settings.exclude,
    placeholder: '12, 345, 6789',
  }) as HTMLInputElement;
  exclude.addEventListener('change', () => save({ exclude: exclude.value }));

  return settingsBox(
    'Réglages de vente',
    state,
    h(
      'div',
      { class: 'kui-fields' },
      settingsField(
        'Prix',
        settingsSelect(
          data.settings.pricePreset,
          Object.entries(PRESETS).map(
            ([key, preset]) => [key, `${preset.label} (${preset.hint})`] as [string, string],
          ),
          (value) => save({ pricePreset: value as SellSettings['pricePreset'] }),
        ),
      ),
      settingsField(
        'Exemplaires à garder',
        settingsNumber(data.settings.keep, 0, 20, (value) => save({ keep: value })),
      ),
      settingsField(
        'Durée de l’annonce',
        settingsSelect(
          String(data.settings.durationHours),
          [
            ['12', '12 h'],
            ['24', '24 h'],
            ['48', '48 h'],
          ],
          (value) => save({ durationHours: Number(value) }),
        ),
      ),
      settingsField(
        'Prix minimum (◆)',
        settingsNumber(data.settings.minPrice, 1, 1_000_000, (value) => save({ minPrice: value })),
      ),
      settingsField(
        'Ventes minimales sur 30 j',
        settingsNumber(data.settings.minSales, 0, 1000, (value) => save({ minSales: value })),
      ),
      settingsField(
        'Emplacements max',
        settingsNumber(data.settings.maxSlots, 1, 100, (value) => save({ maxSlots: value })),
      ),
      settingsField(
        'Vente auto : minutes entre deux passages',
        settingsNumber(data.settings.intervalMin, 5, 120, (value) => save({ intervalMin: value })),
      ),
      settingsField(
        'Vente auto : de (heure)',
        settingsNumber(data.settings.autoFromHour, 0, 23, (value) => save({ autoFromHour: value })),
      ),
      settingsField(
        'Vente auto : à (heure)',
        settingsNumber(data.settings.autoToHour, 0, 23, (value) => save({ autoToHour: value })),
      ),
      settingsField(
        'Vente auto : annonces par passage',
        settingsNumber(data.settings.autoMaxPerPass, 1, 20, (value) =>
          save({ autoMaxPerPass: value }),
        ),
      ),
      h(
        'div',
        { class: 'kui-note' },
        'Vente auto : raretés mises en vente (les autres restent en collection)',
      ),
      ...AUTO_RARITIES.map((rarity) => {
        const input = h('input', { type: 'checkbox' }) as HTMLInputElement;
        input.checked = data.settings.autoRarities.includes(rarity.code);
        input.addEventListener('change', () => {
          const codes = new Set(data.settings.autoRarities);
          if (input.checked) codes.add(rarity.code);
          else codes.delete(rarity.code);
          save({ autoRarities: AUTO_RARITIES.filter((r) => codes.has(r.code)).map((r) => r.code) });
        });
        return h('label', { class: 'kui-check' }, input, h('span', {}, rarity.label));
      }),
      settingsField(
        'Tri',
        settingsSelect(
          data.settings.order,
          [
            ['priceDesc', 'Prix décroissant'],
            ['priceAsc', 'Prix croissant'],
            ['oldest', 'Plus anciens'],
            ['newest', 'Plus récents'],
          ],
          (value) => save({ order: value as SellSettings['order'] }),
        ),
      ),
      settingsField('Ne jamais vendre (identifiants)', exclude),
    ),
    h(
      'p',
      { class: 'kui-note' },
      'Ces réglages sont partagés avec la vente automatique de l’extension ; deux heures identiques la laissent tourner toute la journée.',
    ),
  );
}

function tradeSettingsContent(
  data: PanelTradeData,
  context: ViewContext,
  state: SettingsBoxState,
  onSaved: (settings: TradeSettings) => void,
): HTMLDetailsElement {
  const save = (patch: Partial<TradeSettings>): void => {
    const next = normalizeTradeSettings({ ...data.settings, ...patch });
    void context.saveSettings('Enregistrement des réglages…', async () => {
      await tradeSettingsItem.setValue(next);
      data.settings = next;
      // Recalcule uniquement les résultats avec les données déjà en mémoire.
      onSaved(next);
      return 'Réglages des échanges enregistrés et offres mises à jour.';
    });
  };
  const check = (key: 'tradeSameRarity' | 'tradeUseLast', label: string): HTMLElement => {
    const input = h('input', { type: 'checkbox' }) as HTMLInputElement;
    input.checked = data.settings[key];
    input.addEventListener('change', () => save({ [key]: input.checked }));
    return h('label', { class: 'kui-check' }, input, h('span', {}, label));
  };

  return settingsBox(
    'Réglages d’évaluation',
    state,
    h(
      'div',
      { class: 'kui-fields' },
      settingsField(
        'Écart de valeur accepté (%)',
        settingsNumber(data.settings.tradeTol, 0, 100, (value) => save({ tradeTol: value })),
      ),
      settingsField(
        'Gain minimal pour ma dernière copie (%)',
        settingsNumber(data.settings.tradeLastGain, 0, 500, (value) =>
          save({ tradeLastGain: value }),
        ),
      ),
      settingsField(
        'Actualisation automatique du comptoir (minutes, 0 = jamais)',
        settingsNumber(data.settings.tradeRefreshMin, 0, 60, (value) =>
          save({ tradeRefreshMin: value }),
        ),
      ),
      check('tradeSameRarity', 'Exiger une rareté reçue au moins égale'),
      check('tradeUseLast', 'Autoriser à donner ma dernière copie'),
    ),
    h(
      'p',
      { class: 'kui-note' },
      'Les offres éligibles sont recalculées localement, sans relire le comptoir.',
    ),
  );
}

function listingsContent(data: PanelSaleData, context: ViewContext): HTMLElement {
  if (!data.listings.length) {
    return h('p', { class: 'kui-note' }, 'Aucune annonce active pour le moment.');
  }
  const rows = data.listings.slice(0, 8).map((listing) => {
    const name = listing.name ?? `Carte #${listing.characterId}`;
    const auction = listing.type === 'auction';
    const price = h('input', {
      type: 'number',
      class: 'kui-price-input',
      min: '1',
      step: '1',
      value: String(listing.price),
      'aria-label': `Nouveau prix de ${name}`,
      disabled: auction,
    }) as HTMLInputElement;
    const adjust = guardedButton('Ajuster', 'Confirmer', () =>
      context.perform(`Ajustement de ${name}…`, async () => {
        const result = await gameActions.reprice(
          context.api,
          listing,
          Number(price.value),
          data.settings,
          {
            gapMs: 0,
            log: (message, kind) => void appendActivity(message, kind),
          },
        );
        if (!result.listed) throw new Error(result.message);
        void appendActivity(`Annonce de ${name} ajustée à ${fmt(result.price ?? 0)} ◆.`, 'sale');
        return result.message;
      }),
    );
    if (auction) {
      adjust.disabled = true;
      adjust.title =
        'Une enchère ne peut pas être ajustée ; annule-la puis remets la carte en vente.';
    }
    const cancel = guardedButton('Annuler', 'Confirmer', () =>
      context.perform(`Annulation de ${name}…`, async () => {
                  const result = await gameActions.cancel(context.api, listing.id);
        if (!result.ok) throw new Error(result.message);
        void appendActivity(`Annonce de ${name} annulée.`, 'info');
        return `Annonce de ${name} annulée.`;
      }),
    );
    return h(
      'div',
      { class: 'kui-listing-row' },
      cardThumb(listing.characterId),
      h(
        'div',
        { class: 'kui-row-main' },
        h('b', {}, name),
        h(
          'small',
          {},
          `${auction ? 'Enchère' : 'Prix fixe'} · ${fmt(listing.price)} ◆ · fin ${shortDate(listing.endsAt)}` +
            (listing.bidCount ? ` · ${fmt(listing.bidCount)} offre(s)` : ''),
        ),
      ),
      h('div', { class: 'kui-listing-actions' }, price, adjust, cancel),
    );
  });
  return h(
    'div',
    {},
    list(rows),
    data.listings.length > rows.length
      ? h(
          'p',
          { class: 'kui-note' },
          `+ ${fmt(data.listings.length - rows.length)} autre(s) annonce(s) active(s) non affichée(s).`,
        )
      : null,
  );
}

/**
 * Reprix automatique : désactivé par défaut, borné (plafond horaire, intervalle) et
 * journalisé. Le bouton « Ajuster maintenant » passe les mêmes garde-fous.
 */
function repriceSettingsContent(context: ViewContext): HTMLDetailsElement {
  let settings: RepriceSettings = normalizeRepriceSettings(null);
  let state: RepriceState = normalizeRepriceState(null);

  const box = h(
    'details',
    { class: 'kui-settings-box' },
    h('summary', {}, 'Reprix automatique (suivre la médiane)'),
  ) as HTMLDetailsElement;

  const toggle = h('input', { type: 'checkbox' }) as HTMLInputElement;
  const under = settingsNumber(1, 1, 50, () => {});
  const gain = settingsNumber(3, 1, 10_000, () => {});
  const cap = settingsNumber(4, 1, 12, () => {});
  const every = h('select', { class: 'kui-select' }) as HTMLSelectElement;
  for (const minutes of REPRICE_INTERVALS_MIN) {
    every.append(h('option', { value: String(minutes) }, `${minutes} min`));
  }
  const runNow = guardedButton('Ajuster maintenant', 'Confirmer', () =>
    context.perform('Ajustement des annonces actives…', async () => {
      const result = await runReprice({ api: context.api, force: true });
      try {
        state = normalizeRepriceState(await repriceStateItem.getValue());
      } catch {
        // Un stockage en échec laisse l'état affiché tel quel.
      }
      paint();
      if (result.ok) return `${fmt(result.adjusted)} annonce(s) ajustée(s).`;
      if (result.skipped === 'quota') return 'Plafond horaire atteint : aucun ajustement.';
      if (result.skipped === 'disabled') return 'Reprix désactivé : active-le d’abord.';
      throw new Error(result.error ?? 'Ajustement impossible');
    }),
  );
  const status = h('p', { class: 'kui-note kui-reprice-status', role: 'status' });

  const save = (patch: Partial<RepriceSettings>): void => {
    settings = normalizeRepriceSettings({ ...settings, ...patch });
    void context
      .saveSettings('Enregistrement du reprix…', async () => {
        await repriceSettingsItem.setValue(settings);
        return 'Reprix enregistré.';
      })
      .then(() => paint());
  };

  toggle.addEventListener('change', () => save({ enabled: toggle.checked }));
  under.addEventListener('change', () => save({ underPct: Number(under.value) }));
  gain.addEventListener('change', () => save({ minGain: Number(gain.value) }));
  cap.addEventListener('change', () => save({ maxPerHour: Number(cap.value) }));
  every.addEventListener('change', () => save({ intervalMin: Number(every.value) }));

  function paint(): void {
    toggle.checked = settings.enabled;
    under.value = String(settings.underPct);
    gain.value = String(settings.minGain);
    cap.value = String(settings.maxPerHour);
    every.value = String(settings.intervalMin);
    box.classList.toggle('is-off', !settings.enabled);
    runNow.disabled = !settings.enabled;
    const parts: string[] = [];
    if (!settings.enabled) parts.push('Coupé : aucune annonce n’est ajustée.');
    else if (state.lastError) parts.push(`Dernier échec : ${state.lastError}`);
    else if (!state.at) parts.push('Jamais lancé.');
    else {
      parts.push(
        `Dernier passage ${atLabel(state.at)} · ${fmt(state.lastCount)} ajustement(s) · ${fmt(repriceBudget(state, settings))} place(s) cette heure.`,
      );
    }
    if (settings.enabled && state.retryAt > Date.now()) {
      parts.push(`Pause jusqu’à ${atLabel(state.retryAt)}.`);
    }
    status.textContent = parts.join(' ');
  }

  void Promise.all([repriceSettingsItem.getValue(), repriceStateItem.getValue()])
    .then(([stored, storedState]) => {
      settings = normalizeRepriceSettings(stored);
      state = normalizeRepriceState(storedState);
    })
    .catch(() => undefined)
    .finally(() => paint());

  box.append(
    h(
      'div',
      { class: 'kui-fields' },
      h('label', { class: 'kui-check' }, toggle, h('span', {}, 'Suivre la médiane')),
      settingsField('Baisse visée (%)', under),
      settingsField('Marge minimale (◆)', gain),
      settingsField('Ajustements max par heure', cap),
      settingsField('Minutes entre deux passes', every),
    ),
    // Classe dédiée : le remplissage groupé garde `.kui-quick-actions` pour lui seul.
    h('div', { class: 'kui-reprice-actions' }, runNow),
    status,
    h(
      'p',
      { class: 'kui-note' },
      'Un ajustement retire l’annonce puis la remet en vente : le plafond horaire compte les réussites, une erreur met le reprix en pause.',
    ),
  );
  return box;
}

const DUPLICATES_PER_PAGE = 20;

function saleContent(
  data: PanelSaleData,
  context: ViewContext,
  settingsState: SettingsBoxState,
): HTMLElement {
  const repriceBox = repriceSettingsContent(context);
  const all = data.allCandidates;
  const pages = Math.max(1, Math.ceil(all.length / DUPLICATES_PER_PAGE));
  let page = 1;
  const rowsHost = h('div', { class: 'kui-rows' });
  const pager = h('div', {
    class: 'kui-pager',
    role: 'navigation',
    'aria-label': 'Pages des doublons',
  });
  const pageNote = h('p', { class: 'kui-note' });

  const go = (target: number): void => {
    page = Math.min(pages, Math.max(1, target));
    paintPage();
  };

  const pagerButton = (
    label: string,
    target: number,
    disabled: boolean,
    aria: string,
  ): HTMLButtonElement => {
    const button = h(
      'button',
      { type: 'button', class: 'kui-page', 'aria-label': aria, disabled, title: aria },
      label,
    ) as HTMLButtonElement;
    button.addEventListener('click', () => go(target));
    return button;
  };

  const candidateRow = (candidate: Candidate): HTMLElement => {
    const name = candidate.name ?? `Carte #${candidate.id}`;
    const sell = guardedButton('Vendre', 'Confirmer', () =>
      context.perform(`Mise en vente de ${name}…`, async () => {
        const placed = await gameActions.sell(context.api, data.settings, [candidate], 1, {
          gapMs: 0,
          listed: listedCounts(data.listings),
          source: 'panneau Vente',
          log: (message, kind) => void appendActivity(message, kind),
        });
        if (!placed) {
          throw new Error(candidate.status || candidate.priceWhy || 'Kyara a refusé la vente');
        }
        return `${name} mis en vente.`;
      }),
    );
    if (candidate.blocked || candidate.sellable < 1) {
      sell.disabled = true;
      sell.title = candidate.blocked ?? 'Aucun exemplaire vendable';
    } else if (data.active >= data.maxSlots) {
      sell.disabled = true;
      sell.title = 'Aucun emplacement libre';
    }
    const recycle = guardedButton(`Recycler ×${fmt(candidate.sellable)}`, 'Confirmer', () =>
      context.perform(`Recyclage de ${name}…`, async () => {
        const result = await gameActions.recycle(context.api, candidate.id, candidate.sellable);
        if (!result.ok) throw new Error(`Recyclage refusé : ${result.message}`);
        void appendActivity(
          `${name} : ${fmt(candidate.sellable)} exemplaire(s) recyclé(s).`,
          'sale',
        );
        return `${fmt(candidate.sellable)} exemplaire(s) de ${name} recyclé(s).`;
      }),
    );
    if (candidate.sellable < 1) {
      recycle.disabled = true;
      recycle.title = 'Aucun exemplaire à recycler';
    }
    const protect = guardedButton('Protéger', 'Confirmer', () =>
      context.perform(`Protection de ${name}…`, async () => {
        const next = withExcludedId(data.settings, candidate.id);
        await sellSettingsItem.setValue(next);
        let warning = '';
        try {
          const result = await gameActions.pin(context.api, candidate.id, true);
          if (!result.ok) warning = result.message;
        } catch (error) {
          warning = explainPanelError(error);
        }
        void appendActivity(
          warning
            ? `${name} exclue de la vente ; cadenas Kyara refusé (${warning}).`
            : `${name} protégée et verrouillée sur Kyara.`,
          warning ? 'warn' : 'sale',
        );
        return warning
          ? `${name} ne sera plus vendue, mais le cadenas Kyara a été refusé : ${warning}`
          : `${name} ne sera plus vendue et porte le cadenas Kyara.`;
      }),
    );
    protect.title = 'Ne jamais vendre cette carte et poser le cadenas Kyara';
    return actionRow(
      name,
      `×${fmt(candidate.sellable)} vendable(s) · ${priceLabel(candidate.price)}` +
        (candidate.rarity ? ` · ${candidate.rarity}` : '') +
        (candidate.blocked ? ` · ${candidate.blocked}` : ''),
      h('div', { class: 'kui-row-actions' }, sell, recycle, protect),
      candidate.id,
    );
  };

  function paintPage(): void {
    page = Math.min(pages, Math.max(1, page));
    const start = (page - 1) * DUPLICATES_PER_PAGE;
    const slice = all.slice(start, start + DUPLICATES_PER_PAGE);
    rowsHost.replaceChildren(...slice.map(candidateRow));
    pageNote.textContent = all.length
      ? `Doublons ${fmt(start + 1)}–${fmt(start + slice.length)} sur ${fmt(all.length)} · page ${fmt(page)} / ${fmt(pages)}`
      : 'Aucun doublon dans la collection.';
    const numbers: HTMLButtonElement[] = [];
    for (let index = Math.max(1, page - 2); index <= Math.min(pages, page + 2); index += 1) {
      const button = pagerButton(
        String(index),
        index,
        false,
        index === page ? `Page ${index}, affichée` : `Page ${index}`,
      );
      if (index === page) {
        button.classList.add('is-current');
        button.setAttribute('aria-current', 'page');
      }
      numbers.push(button);
    }
    pager.replaceChildren(
      pagerButton('«', 1, page === 1, 'Première page'),
      pagerButton('‹', page - 1, page === 1, 'Page précédente'),
      ...numbers,
      pagerButton('›', page + 1, page === pages, 'Page suivante'),
      pagerButton('»', pages, page === pages, 'Dernière page'),
    );
  }

  const fill = guardedButton(
    data.free ? `Remplir ${fmt(data.free)} emplacement(s)` : 'Aucun emplacement libre',
    'Confirmer',
    () =>
      context.perform('Mise en vente des doublons sélectionnés…', async () => {
        const todo = fillSelection(data.candidates, data.free);
        if (!todo.length) throw new Error('Aucun doublon sélectionnable pour le moment.');
        const placed = await gameActions.sell(context.api, data.settings, todo, data.free, {
          gapMs: 600,
          reason: 'vente groupée',
          listed: listedCounts(data.listings),
          source: 'panneau Vente (remplissage)',
          log: (message, kind) => void appendActivity(message, kind),
        });
        if (!placed) throw new Error('Kyara a refusé les mises en vente.');
        return `${fmt(placed)} annonce(s) créée(s).`;
      }),
  );
  fill.disabled = data.free <= 0 || !data.candidates.length;
  paintPage();

  return h(
    'div',
    {},
    advisorBlock(context),
    h('h3', { class: 'kui-section-title' }, 'Annonces actives'),
    listingsContent(data, context),
    h(
      'p',
      { class: 'kui-note' },
      'Deux clics sur les actions : le prix est relu sur Kyara avant chaque mise en vente ou ajustement. Aucune estimation locale.',
    ),
    saleSettingsContent(data, context, settingsState),
    repriceBox,
    h('h3', { class: 'kui-section-title' }, 'Statistiques de ventes'),
    metrics([
      ['Annonces', `${fmt(data.active)} / ${fmt(data.maxSlots)}`],
      ['Emplacements libres', fmt(data.free)],
      ['Doublons', fmt(data.duplicates)],
      ['Vendables', fmt(data.sellable)],
    ]),
    h('h3', { class: 'kui-section-title' }, 'Vente automatique'),
    h(
      'div',
      { class: 'kui-metrics' },
      metric(
        'Mode',
        !data.autoSell.enabled
          ? 'Désactivée'
          : (AUTOMATION_STATE[data.autoSell.status?.state ?? ''] ?? 'Active'),
      ),
      metric(
        'Annonces actives',
        data.autoSell.status?.active === null || data.autoSell.status?.active === undefined
          ? '—'
          : fmt(data.autoSell.status.active),
      ),
      metric('Créées', fmt(data.autoSell.status?.placed ?? 0)),
      metric(
        'Prochain passage',
        data.autoSell.status?.nextAt ? atLabel(data.autoSell.status.nextAt) : '—',
      ),
    ),
    h(
      'p',
      { class: 'kui-note' },
      !data.autoSell.enabled
        ? 'Active la vente automatique dans l’onglet Réglages.'
        : data.autoSell.status
          ? data.autoSell.status.message
          : 'Aucun passage enregistré : garde un onglet kyara.games ouvert.',
    ),
    data.autoSell.log.length
      ? h(
          'ul',
          { class: 'kui-activity-log' },
          ...data.autoSell.log.map((entry) => h('li', {}, `${atLabel(entry.t)} · ${entry.m}`)),
        )
      : null,
    h('h3', { class: 'kui-section-title' }, 'Vendre un doublon'),
    h(
      'p',
      { class: 'kui-note' },
      `Collection complète : ${fmt(all.length)} doublon(s), ${fmt(DUPLICATES_PER_PAGE)} par page.`,
    ),
    rowsHost,
    pager,
    pageNote,
    h('div', { class: 'kui-quick-actions' }, fill),
  );
}

function acceptDealButton(
  deal: PanelTradeData['top'][number],
  context: ViewContext,
): HTMLButtonElement {
  return guardedButton('Accepter', 'Confirmer', () =>
    context.perform('Acceptation de l’échange…', async () => {
      await gameActions.acceptTrade(context.api, deal.offerId, deal.giveId);
      void appendActivity(`Échange accepté : ${deal.leftName} a rejoint ta collection.`, 'sale');
      return `Échange accepté : ${deal.leftName} rejoint ta collection.`;
    }),
  );
}

function offerRow(offer: PanelTradeData['all'][number], context: ViewContext): HTMLElement {
  const deal = offer.deal;
  const accept = deal ? acceptDealButton(deal, context) : null;
  const detail = deal
    ? `${offer.userPseudo} · donne ${deal.giveName} ×${fmt(deal.giveN)}` + ` · +${fmt(deal.gain)} ◆`
    : `${offer.userPseudo} · demande ${offer.wantNames.join(', ') || '—'}`;
  return actionRow(
    offer.leftName,
    detail,
    accept ?? h('span', { class: 'kui-chip kui-chip-muted' }, offer.reason),
    offer.leftId,
  );
}

/** Conserve la position de lecture quand seuls les résultats au-dessus changent. */
function preserveScroll(container: HTMLElement, update: () => void): void {
  const before = container.getBoundingClientRect();
  const anchor = [
    ...container.querySelectorAll<HTMLElement>(
      '.kui-settings-box, .kui-metrics, .kui-section-title, .kui-offers, .kui-note',
    ),
  ].find((element) => element.getBoundingClientRect().bottom > before.top);
  const offset = anchor ? anchor.getBoundingClientRect().top - before.top : 0;
  update();
  if (!anchor?.isConnected) return;
  const next = anchor.getBoundingClientRect().top - container.getBoundingClientRect().top;
  container.scrollTop += next - offset;
}

function tradesContent(
  data: PanelTradeData,
  context: ViewContext,
  settingsState: SettingsBoxState,
): HTMLElement {
  const offersMetric = metric('Offres lues', fmt(data.all.length));
  const dealsMetric = metric('Bons échanges', fmt(data.deals));
  const metricsBox = h('div', { class: 'kui-metrics' }, offersMetric, dealsMetric);
  const topHost = h('div', {});
  const offersSummary = h('summary');
  const offerList = h('div', { class: 'kui-rows' });
  const offersDetails = h(
    'details',
    { class: 'kui-offers', open: true },
    offersSummary,
    offerList,
  ) as HTMLDetailsElement;
  const marketHost = h('div', { class: 'kui-market-analysis' });
  const marketButton = trustedButton('Analyser tout le marché', () => {
    marketButton.disabled = true;
    context.setStatus('Analyse de tout le marché…');
    void scanDeals(context.api, undefined, {
      pages: 12,
      maxChecks: 12,
      minDiscount: 15,
      minProfit: 1,
    })
      .then((scan) => {
        marketHost.replaceChildren(
          h(
            'p',
            { class: 'kui-note' },
            `${fmt(scan.scanned)} annonce(s) lues sur ${fmt(scan.pages)} page(s) · ` +
              `${fmt(scan.deals.length)} affaire(s) rentable(s)` +
              (scan.errors ? ` · ${fmt(scan.errors)} vérification(s) en échec` : ''),
          ),
          scan.deals.length
            ? list(
                scan.deals.slice(0, 30).map((deal) =>
                  actionRow(
                    deal.listing.name ?? `Carte #${deal.listing.characterId}`,
                    `achat ${fmt(deal.listing.price)} ◆ → revente ${fmt(deal.resale)} ◆ · ` +
                      `net ${fmt(deal.net)} ◆`,
                    h('span', { class: 'kui-chip is-deal' }, `+${fmt(deal.profit)} ◆`),
                    deal.listing.characterId,
                  ),
                ),
              )
            : h('p', { class: 'kui-note' }, 'Aucune occasion rentable sur tout le marché.'),
        );
        context.setStatus(`Marché analysé : ${fmt(scan.scanned)} annonce(s).`);
        marketButton.disabled = false;
        marketButton.textContent = 'Relancer l’analyse du marché';
      })
      .catch((error: unknown) => {
        marketHost.replaceChildren(
          h(
            'p',
            { class: 'kui-data-error' },
            `Analyse impossible : ${explainPanelError(error)}`,
          ),
        );
        context.setStatus('Analyse du marché impossible.');
        marketButton.disabled = false;
      });
  });

  const paintResults = (): void => {
    const dealsValue = dealsMetric.querySelector('strong');
    if (dealsValue) dealsValue.textContent = fmt(data.deals);
    topHost.replaceChildren(
      data.top.length
        ? list(
            data.top.map((deal) =>
              actionRow(
                deal.leftName,
                `Donne ${deal.giveName} ×${fmt(deal.giveN)}` +
                  (deal.up ? ' · rareté supérieure' : '') +
                  ` · +${fmt(deal.gain)} ◆`,
                acceptDealButton(deal, context),
                deal.leftId,
              ),
            ),
          )
        : h(
            'p',
            { class: 'kui-note' },
            data.all.length
              ? 'Aucun échange ne passe tes réglages pour le moment.'
              : 'Aucune offre ouverte sur le comptoir.',
          ),
    );
    offersDetails.hidden = data.all.length === 0;
    offersSummary.textContent = `Toutes les offres (${fmt(data.all.length)})`;
    offerList.replaceChildren(...data.all.map((offer) => offerRow(offer, context)));
  };

  const refresh = (settings: TradeSettings): void => {
    const evaluation = data.reevaluate(settings);
    data.deals = evaluation.deals;
    data.top = evaluation.top;
    data.all = evaluation.all;
    const body = settingsBox.closest<HTMLElement>('.kui-body');
    if (body) preserveScroll(body, paintResults);
    else paintResults();
  };

  const settingsBox = tradeSettingsContent(data, context, settingsState, refresh);
  paintResults();
  return h(
    'div',
    {},
    settingsBox,
    metricsBox,
    h('h3', { class: 'kui-section-title' }, 'Accepter un bon échange'),
    topHost,
    offersDetails,
    h('h3', { class: 'kui-section-title' }, 'Analyse complète du marché'),
    h(
      'p',
      { class: 'kui-note' },
      'Douze pages d’annonces à prix fixe, une vérification par carte : les reventes rentables ' +
        'après frais sont listées, enchères écartées. Lecture seule, aucune annonce achetée.',
    ),
    h('div', { class: 'kui-quick-actions' }, marketButton),
    marketHost,
    h(
      'p',
      { class: 'kui-note' },
      'Deux clics sur Accepter. Kyara reste l’autorité : une offre périmée peut être refusée.',
    ),
  );
}

type BuyTab = 'fixed' | 'auction' | 'orders';

const BUY_RARITIES: readonly [string, string][] = [
  ['', 'Toutes raretés'],
  ['C', 'Commune'],
  ['U', 'Peu commune'],
  ['R', 'Rare'],
  ['E', 'Épique'],
  ['L', 'Légendaire'],
  ['M', 'Mythique'],
];

/** Achat groupé : prix fixe, enchères, ordres sur les cartes manquantes. */
function buyContent(data: PanelBuyData, context: ViewContext): HTMLElement {
  let tab: BuyTab = 'fixed';
  const status = h('p', { class: 'kui-note', role: 'status' });
  const host = h('div', {});
  const segments = h('div', { class: 'kui-subtabs', role: 'tablist', 'aria-label': 'Achat' });
  const LABELS: Record<BuyTab, string> = {
    fixed: 'Prix fixe',
    auction: 'Enchères',
    orders: 'Ordres d’achat',
  };

  const say = (message: string): void => {
    status.textContent = message;
    context.setStatus(message);
  };

  // État partagé entre les onglets : une recherche lancée n'est pas perdue en changeant d'onglet.
  const fixed = {
    max: 500,
    /** Rareté demandée au site ; vide = toutes. */
    rarity: '',
    listings: [] as MarketListing[],
    /** Résultat cumulé, pour prolonger une lecture partielle sans perdre les pages lues. */
    result: null as MarketSearchResult | null,
    selected: new Set<string>(),
    /** Dernière page lue et avancement de la lecture. */
    page: 0,
    scanned: 0,
    total: null as number | null,
    complete: false,
    /** Filtre local : masquer les cartes déjà possédées. */
    hideOwned: false,
    /** Cartes manquantes demandées au site (`missing=1`). */
    missingOnly: false,
    /** Lecture complète en cours et demande d'arrêt. */
    readingAll: false,
    cancel: false,
    busy: false,
    loaded: false,
  };
  const auction = {
    listings: [] as MarketListing[],
    max: new Map<string, number>(),
    loaded: false,
    /** Miser dans la dernière minute plutôt que tout de suite. */
    snipe: false,
    /** Minuteries des mises programmées, annulables depuis le panneau. */
    timers: [] as number[],
  };
  const orders = {
    rarity: '',
    strategy: 'median' as 'median' | 'm20' | 'best1' | 'fixed',
    fixed: 15,
    dmin: 2,
    dmax: 4,
    selected: new Set<number>(),
    /** Prix saisi à la main : absent = prix calculé par la stratégie. */
    overrides: new Map<number, number>(),
    busy: false,
  };

  /** Lignes affichées au plus ; les groupes de prix restent toujours entiers. */
  const FIXED_RENDER_LIMIT = 200;

  /** Regroupe les annonces par prix, du moins cher au plus cher. */
  function groupByPrice(
    listings: readonly MarketListing[],
  ): { price: number; items: MarketListing[] }[] {
    const groups = new Map<number, MarketListing[]>();
    for (const listing of listings) {
      const items = groups.get(listing.price);
      if (items) items.push(listing);
      else groups.set(listing.price, [listing]);
    }
    return [...groups.entries()]
      .sort(([left], [right]) => left - right)
      .map(([price, items]) => ({
        price,
        items: items.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '', 'fr')),
      }));
  }

  /** Passes au plus pour « Tout lire » (≈ 4 800 pages). */
  const MAX_MARKET_PASSES = 600;

  /** Durée lisible : « 40 s », « 2 min 10 s ». */
  function formatEta(ms: number): string {
    const seconds = Math.max(1, Math.round(ms / 1_000));
    if (seconds < 60) return `${seconds} s`;
    const minutes = Math.floor(seconds / 60);
    const rest = seconds % 60;
    return rest ? `${minutes} min ${rest} s` : `${minutes} min`;
  }

  const fixedBox = (): HTMLElement => {
    const max = h('input', {
      type: 'number',
      class: 'kui-number-input',
      min: '1',
      max: '100000',
      value: String(fixed.max),
      'aria-label': 'Prix maximum par carte',
    }) as HTMLInputElement;
    max.addEventListener('change', () => {
      fixed.max = Math.max(1, Math.round(Number(max.value) || 1));
      max.value = String(fixed.max);
      renderRows();
    });
    const rarity = settingsSelect(
      fixed.rarity,
      BUY_RARITIES.map(([value, label]) => [value, label]),
      (value) => {
        fixed.rarity = value;
        resetFixed();
        paint();
        say('Rareté choisie : relance l’analyse du marché.');
      },
    );
    const checkField = (
      label: string,
      checked: boolean,
      onChange: (value: boolean) => void,
    ): HTMLElement => {
      const input = h('input', { type: 'checkbox' }) as HTMLInputElement;
      input.checked = checked;
      input.addEventListener('change', () => onChange(input.checked));
      return h('label', { class: 'kui-field kui-check-field' }, input, h('span', {}, label));
    };
    const hideOwned = checkField('Masquer les possédées', fixed.hideOwned, (value) => {
      fixed.hideOwned = value;
      renderRows();
    });
    const missingOnly = checkField('Cartes manquantes', fixed.missingOnly, (value) => {
      fixed.missingOnly = value;
      resetFixed();
      paint();
      say(
        value
          ? 'Cartes manquantes : relance l’analyse du marché.'
          : 'Analyse élargie à toutes les cartes : relance-la.',
      );
    });
    const rowsHost = h('div', { class: 'kui-rows kui-price-groups' });
    const summary = h('span', { class: 'kui-selection-summary' });
    let renderedIds: string[] = [];
    let groupChecks: { check: HTMLInputElement; ids: string[] }[] = [];
    let rowChecks: { check: HTMLInputElement; id: string }[] = [];

    const buy = guardedButton('Acheter la sélection', 'Confirmer', () => {
      const lines = chosenLines();
      if (!lines.length) return;
      const total = lines.reduce((sum, line) => sum + line.price, 0);
      fixed.busy = true;
      buy.disabled = true;
      say(`Achat de ${fmt(lines.length)} annonce(s) · ${fmt(total)} ◆…`);
      void buyListings(context.api, lines, {
        gapMs: 1_200,
        onBuy: async (line, outcome) => {
          // Écriture attendue : plusieurs achats d'affilée ne doivent pas se perdre.
          await recordPurchaseEntry({
            characterId: line.characterId ?? 0,
            name: line.name ?? null,
            price: outcome.paid ?? line.price,
            kind: 'listing',
            listingId: line.id,
          });
        },
        onProgress: (done, count, spent) =>
          say(`Achat ${fmt(done)} / ${fmt(count)} · ${fmt(spent)} ◆`),
      })
        .then((result) => {
          say(
            `Achats : ${fmt(result.bought)} réussie(s) · ${fmt(result.spent)} ◆` +
              (result.stop ? ` · arrêt : ${result.stop}` : '') +
              ' · relance l’analyse pour actualiser la liste.',
          );
          fixed.selected.clear();
          fixed.busy = false;
          paint();
        })
        .catch((error: unknown) => {
          fixed.busy = false;
          say(`Achat impossible : ${explainPanelError(error)}`);
          paint();
        });
    });
    const selectAll = trustedButton('Tout sélectionner', () => {
      for (const id of renderedIds) fixed.selected.add(id);
      syncSelection();
    });
    const clearAll = trustedButton('Tout désélectionner', () => {
      fixed.selected.clear();
      syncSelection();
    });
    const more = trustedButton('Lire la suite', () => analyze(true));
    const search = trustedButton('Analyser le marché', () => analyze(false));
    const readAll = trustedButton('Tout lire', () => readEverything());
    const stop = trustedButton('Arrêter', () => {
      fixed.cancel = true;
      say('Arrêt demandé : la passe en cours se termine.');
    });

    /** Vrai quand l'annonce passe les filtres locaux (prix, rareté, possession). */
    function shows(listing: MarketListing): boolean {
      return (
        listing.price <= fixed.max &&
        (!fixed.rarity || rarityCode(listing.rarity) === fixed.rarity) &&
        (!fixed.hideOwned || !data.ownedIds.has(listing.characterId))
      );
    }

    /**
     * Une seule annonce par carte : la moins chère, puis la fin la plus proche. Acheter
     * plusieurs exemplaires de la même carte n'a pas d'intérêt pour compléter un album.
     */
    function bestPerCard(): MarketListing[] {
      const best = new Map<number, MarketListing>();
      for (const listing of fixed.listings) {
        if (!shows(listing)) continue;
        const current = best.get(listing.characterId);
        if (
          !current ||
          listing.price < current.price ||
          (listing.price === current.price && (listing.endsAt ?? '') < (current.endsAt ?? ''))
        ) {
          best.set(listing.characterId, listing);
        }
      }
      return [...best.values()];
    }

    function chosenLines(): {
      id: string;
      name?: string | null;
      price: number;
      characterId: number;
    }[] {
      // Seules les annonces affichées comptent : baisser le prix max ou changer de
      // rareté retire de la sélection ce qui n'est plus visible.
      return bestPerCard()
        .filter((listing) => fixed.selected.has(listing.id))
        .map((listing) => ({
          id: listing.id,
          name: listing.name,
          price: listing.price,
          characterId: listing.characterId,
        }));
    }

    function updateSelection(): void {
      const chosen = chosenLines();
      const total = chosen.reduce((sum, line) => sum + line.price, 0);
      summary.textContent = chosen.length
        ? `${fmt(chosen.length)} annonce(s) sélectionnée(s) · ${fmt(total)} ◆`
        : 'Aucune annonce sélectionnée.';
      buy.disabled = fixed.busy || chosen.length === 0;
      clearAll.disabled = fixed.busy || chosen.length === 0;
      selectAll.disabled =
        fixed.busy || renderedIds.length === 0 || renderedIds.every((id) => fixed.selected.has(id));
    }

    function syncSelection(): void {
      for (const item of rowChecks) item.check.checked = fixed.selected.has(item.id);
      for (const group of groupChecks) {
        const all = group.ids.every((id) => fixed.selected.has(id));
        const some = group.ids.some((id) => fixed.selected.has(id));
        group.check.checked = all;
        group.check.indeterminate = some && !all;
      }
      updateSelection();
    }

    /** Couverture honnête de la lecture : annonces lues, total annoncé et état. */
    function coverage(): string {
      const shown = bestPerCard().length;
      const rarityLabel = BUY_RARITIES.find(([value]) => value === fixed.rarity)?.[1];
      const scope = [rarityLabel, fixed.missingOnly ? 'cartes manquantes' : '']
        .filter(Boolean)
        .join(' · ');
      const suffix = scope ? ` · ${scope}` : '';
      if (fixed.total === null) {
        return `${fmt(shown)} annonce(s)${suffix} · ${fmt(fixed.scanned)} lue(s) · total annoncé inconnu`;
      }
      const percent = fixed.total
        ? fixed.scanned > 0
          ? Math.max(1, Math.min(100, Math.round((fixed.scanned / fixed.total) * 100)))
          : 0
        : 100;
      return (
        `${fmt(shown)} annonce(s) sous ${fmt(fixed.max)} ◆${suffix} · ` +
        `${fmt(fixed.scanned)} / ${fmt(fixed.total)} annonce(s) lue(s) (${percent} %)` +
        (fixed.complete ? ' · analyse complète' : ' · lecture partielle')
      );
    }

    function resetFixed(): void {
      fixed.result = null;
      fixed.listings = [];
      fixed.selected.clear();
      fixed.page = 0;
      fixed.scanned = 0;
      fixed.total = null;
      fixed.complete = false;
      fixed.loaded = false;
    }

    function renderRows(): void {
      renderedIds = [];
      groupChecks = [];
      rowChecks = [];
      rowsHost.replaceChildren();
      if (!fixed.loaded) {
        rowsHost.append(
          h('p', { class: 'kui-note' }, 'Lance l’analyse pour lire les annonces à prix fixe.'),
        );
        updateSelection();
        return;
      }
      const shown = bestPerCard();
      if (!shown.length) {
        rowsHost.append(
          h(
            'p',
            { class: 'kui-note' },
            'Aucune carte avec ces filtres : élargis le prix max ou décoche une option.',
          ),
        );
        updateSelection();
        return;
      }
      let painted = 0;
      let hidden = 0;
      for (const group of groupByPrice(shown)) {
        if (painted >= FIXED_RENDER_LIMIT) {
          hidden += group.items.length;
          continue;
        }
        painted += group.items.length;
        const ids = group.items.map((listing) => listing.id);
        const groupCheck = h('input', {
          type: 'checkbox',
          'aria-label': `Toutes les annonces à ${fmt(group.price)} ◆`,
        }) as HTMLInputElement;
        groupCheck.checked = ids.every((id) => fixed.selected.has(id));
        groupCheck.indeterminate = !groupCheck.checked && ids.some((id) => fixed.selected.has(id));
        groupCheck.addEventListener('change', () => {
          if (groupCheck.checked) for (const id of ids) fixed.selected.add(id);
          else for (const id of ids) fixed.selected.delete(id);
          syncSelection();
        });
        groupChecks.push({ check: groupCheck, ids });
        const rows = group.items.map((listing) => {
          const check = h('input', { type: 'checkbox' }) as HTMLInputElement;
          check.checked = fixed.selected.has(listing.id);
          check.setAttribute(
            'aria-label',
            `Acheter ${listing.name ?? `la carte #${listing.characterId}`} à ${fmt(listing.price)} ◆`,
          );
          check.addEventListener('change', () => {
            if (check.checked) fixed.selected.add(listing.id);
            else fixed.selected.delete(listing.id);
            syncSelection();
          });
          rowChecks.push({ check, id: listing.id });
          renderedIds.push(listing.id);
          const rarity = rarityCode(listing.rarity);
          const owned = data.ownedIds.has(listing.characterId);
          return h(
            'div',
            { class: 'kui-data-row' },
            cardThumb(listing.characterId),
            h(
              'div',
              { class: 'kui-row-main' },
              h('b', {}, listing.name ?? `Carte #${listing.characterId}`),
              h(
                'small',
                {},
                `${rarity ? `${rarity} · ` : ''}${listing.series ?? 'sans série'} · ` +
                  `${formatEndsIn(listing.endsAt) ?? 'sans fin'}` +
                  (listing.median ? ` · médiane ${fmt(listing.median)} ◆` : ''),
              ),
            ),
            owned ? h('span', { class: 'kui-chip kui-chip-muted' }, 'possédée') : null,
            check,
          );
        });
        rowsHost.append(
          h(
            'div',
            { class: 'kui-price-group', 'data-price': String(group.price) },
            h(
              'div',
              { class: 'kui-price-group-head' },
              h('b', {}, `${fmt(group.price)} ◆`),
              h(
                'span',
                { class: 'kui-note' },
                `${fmt(ids.length)} annonce(s) · ${fmt(group.price * ids.length)} ◆ au total`,
              ),
              h(
                'label',
                { class: 'kui-price-group-toggle' },
                groupCheck,
                h('span', {}, 'Tout ce prix'),
              ),
            ),
            ...rows,
          ),
        );
      }
      if (hidden) {
        rowsHost.append(
          h(
            'p',
            { class: 'kui-note' },
            `${fmt(hidden)} annonce(s) au-delà de ${fmt(FIXED_RENDER_LIMIT)} lignes : ` +
              'réduis le prix max ou choisis une rareté.',
          ),
        );
      }
      updateSelection();
    }

    /** Lit une passe de pages ; ne touche ni à `busy` ni au rendu. */
    async function readPass(extend: boolean): Promise<void> {
      const startPage = extend ? fixed.page + 1 : 1;
      const startedAt = Date.now();
      const result = await searchMarket(
        context.api,
        {
          sort: 'newest',
          ...(fixed.rarity ? { rarity: fixed.rarity } : {}),
          ...(fixed.missingOnly ? { missing: true } : {}),
        },
        {
          noAuction: true,
          order: 'deal',
          maxPages: MARKET_MAX_PAGES,
          startPage,
          onPage: (_fresh, page, total) => {
            // En prolongement, l'estimation ne compte que les pages de la passe en
            // cours : le débit des pages déjà lues avant « Lire la suite » ne doit
            // pas gonfler l'avancement annoncé pendant la nouvelle passe.
            const { scanned, remainingMs } = estimatePassRemaining({
              page,
              startPage,
              total,
              elapsedMs: Date.now() - startedAt,
            });
            say(
              `Lecture : ${fmt(scanned)} / ${total === null ? '?' : fmt(total)} annonce(s)` +
                (remainingMs > 1_000 ? ` · ≈ ${formatEta(remainingMs)} restantes` : ''),
            );
          },
        },
      );
      fixed.result = fixed.result
        ? mergeSearchResults(fixed.result, result, { noAuction: true })
        : result;
      fixed.listings = fixed.result.listings;
      fixed.page = Math.max(fixed.page, result.pages);
      fixed.scanned = Math.min(
        fixed.result.total ?? Number.POSITIVE_INFINITY,
        fixed.result.scanned ?? result.pages * MARKET_PAGE_SIZE,
      );
      fixed.total = fixed.result.total;
      fixed.complete = fixed.result.complete;
      fixed.loaded = true;
    }

    /** Une passe de huit pages, avec le bouton d'origine. */
    function analyze(extend: boolean): void {
      if (fixed.busy) return;
      fixed.busy = true;
      fixed.readingAll = false;
      fixed.cancel = false;
      if (!extend) resetFixed();
      paint();
      say(extend ? 'Lecture de la suite du marché…' : 'Analyse du marché…');
      void readPass(extend)
        .then(() => {
          fixed.busy = false;
          paint();
          say(coverage());
        })
        .catch((error: unknown) => {
          fixed.busy = false;
          say(`Analyse impossible : ${explainPanelError(error)}`);
          paint();
        });
    }

    /**
     * Analyse complète en une action : enchaîne les passes jusqu'au total annoncé,
     * en affichant les résultats à chaque passe. L'arrêt prend effet à la fin de la
     * passe en cours, ou tout de suite après deux passes sans nouveau résultat.
     */
    function readEverything(): void {
      if (fixed.busy) return;
      resetFixed();
      fixed.busy = true;
      fixed.readingAll = true;
      fixed.cancel = false;
      paint();
      say('Analyse complète du marché : première passe…');
      void (async () => {
        let passes = 0;
        let empty = 0;
        while (!fixed.cancel && !fixed.complete && passes < MAX_MARKET_PASSES) {
          const before = fixed.listings.length;
          await readPass(passes > 0);
          passes += 1;
          empty = fixed.listings.length > before ? 0 : empty + 1;
          paint();
          say(
            `Analyse complète · passe ${fmt(passes)} · ${coverage()}` +
              (fixed.complete ? '' : ' · Arrêter pour interrompre'),
          );
          if (empty >= 2) break;
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        fixed.busy = false;
        fixed.readingAll = false;
        paint();
        say(
          fixed.complete
            ? `Analyse complète terminée · ${coverage()}`
            : fixed.cancel
              ? `Analyse arrêtée · ${coverage()}`
              : `Analyse arrêtée faute de nouveaux résultats · ${coverage()}`,
        );
      })().catch((error: unknown) => {
        fixed.busy = false;
        fixed.readingAll = false;
        say(`Analyse impossible : ${explainPanelError(error)}`);
        paint();
      });
    }

    search.disabled = fixed.busy;
    readAll.disabled = fixed.busy;
    more.disabled = fixed.busy || !fixed.loaded || fixed.complete;
    renderRows();
    return h(
      'div',
      {},
      h(
        'p',
        { class: 'kui-note' },
        'Analyse du marché à prix fixe, page par page (48 annonces, 8 pages par passe) : ' +
          'rareté, cartes manquantes et possession en filtres, annonces lues sur le total ' +
          'annoncé, temps restant estimé. Une seule annonce par carte est affichée : la moins ' +
          'chère. « Tout lire » enchaîne les passes jusqu’au bout ; coche des cartes, ou tout ' +
          'un prix d’un clic, puis confirme : achat une par une.',
      ),
      h(
        'div',
        { class: 'kui-buy-tools' },
        settingsField('Prix max.', max),
        settingsField('Rareté', rarity),
        missingOnly,
        hideOwned,
        search,
        readAll,
        fixed.readingAll ? stop : null,
        fixed.loaded && !fixed.complete && !fixed.readingAll ? more : null,
      ),
      fixed.loaded ? h('p', { class: 'kui-note kui-buy-coverage' }, coverage()) : null,
      h(
        'div',
        { class: 'kui-selection-bar' },
        summary,
        h('div', { class: 'kui-selection-actions' }, selectAll, clearAll, buy),
      ),
      rowsHost,
    );
  };

  const auctionBox = (): HTMLElement => {
    const rowsHost = h('div', { class: 'kui-rows' });
    const search = trustedButton('Chercher les enchères', () => {
      search.disabled = true;
      say('Lecture des enchères…');
      void searchMarket(context.api, { sort: 'ending' }, { order: 'ending', maxPages: 3 })
        .then(async (result) => {
          auction.listings = result.listings.filter(
            (listing) => listing.auction && !data.ownedIds.has(listing.characterId),
          );
          auction.loaded = true;
          for (const listing of auction.listings) {
            if (!auction.max.has(listing.id)) {
              auction.max.set(listing.id, listing.buyout ?? listing.price + 10);
            }
          }
          say(`${fmt(auction.listings.length)} enchère(s) ouverte(s).`);
          // Une carte arrivée dans la collection confirme l'enchère qui l'a emportée.
          const confirmed = await confirmAuctions().catch(() => 0);
          if (confirmed) say(`${fmt(confirmed)} enchère(s) gagnée(s) notée(s) dans les dépenses.`);
          paint();
        })
        .catch((error: unknown) => say(`Recherche impossible : ${explainPanelError(error)}`));
    });
    /**
     * Note une mise en tête : c'est de l'argent engagé, pas une enchère gagnée. Le journal
     * la garde en attente (une seule ligne par annonce) jusqu'à ce que la carte arrive
     * dans la collection, seule preuve locale d'une victoire.
     */
    async function recordAuctionBid(
      listingId: string,
      characterId: number | undefined,
      name: string | null,
      outcome: { leading: boolean; currentBid: number | null },
      maxAmount: number,
    ): Promise<void> {
      if (!outcome.leading) return;
      await recordPurchaseEntry({
        characterId: characterId ?? 0,
        name,
        price: outcome.currentBid ?? maxAmount,
        kind: 'auction',
        listingId,
        pending: true,
      });
    }

    /** Confirme les enchères dont la carte est maintenant possédée. */
    async function confirmAuctions(): Promise<number> {
      const stored = normalizePurchases(await purchasesItem.getValue().catch(() => null));
      const { purchases, confirmed } = confirmWonAuctions(stored, data.ownedIds);
      if (!confirmed.length) return 0;
      await purchasesItem.setValue(purchases).catch(() => undefined);
      return confirmed.length;
    }

    /** Programme une mise pour la dernière minute de l'enchère, sans bloquer le panneau. */
    function scheduleSnipes(
      lines: { id: string; characterId: number; name: string | null; endsAt: string | null; maxAmount: number }[],
    ): void {
      let planned = 0;
      for (const line of lines) {
        const delay = snipeDelay(line.endsAt);
        if (delay === null) {
          say(`${line.name ?? `Carte #${line.id}`} : échéance inconnue, mise immédiate impossible à programmer.`);
          continue;
        }
        planned += 1;
        const timer = window.setTimeout(() => {
          auction.timers = auction.timers.filter((id) => id !== timer);
          void (async () => {
            // Le plafond du jour est relu au moment de la mise, pas à la programmation.
            const refus = spendProblem(await loadDaySpend(), line.maxAmount);
            if (refus) {
              say(`${line.name ?? `Carte #${line.id}`} : ${refus}`);
              paint();
              return;
            }
            const outcome = await bidListing(context.api, line.id, line.maxAmount);
            if (outcome.ok) {
              await recordAuctionBid(line.id, line.characterId, line.name, outcome, line.maxAmount);
            }
            say(`${line.name ?? `Carte #${line.id}`} : ${outcome.message}`);
            paint();
          })().catch((error: unknown) => say(`Mise impossible : ${explainPanelError(error)}`));
        }, delay);
        auction.timers.push(timer);
      }
      say(
        `${fmt(planned)} mise(s) programmée(s) dans la dernière minute — garde cet onglet ouvert.`,
      );
      paint();
    }

    const bid = guardedButton('Miser sur la sélection', 'Confirmer', () => {
      const lines = auction.listings
        .filter((listing) => auction.max.has(listing.id))
        .map((listing) => ({
          id: listing.id,
          characterId: listing.characterId,
          name: listing.name,
          endsAt: listing.endsAt,
          maxAmount: auction.max.get(listing.id) ?? listing.price,
        }));
      if (!lines.length) return;
      if (auction.snipe) {
        scheduleSnipes(lines);
        return;
      }
      say(`Mise sur ${fmt(lines.length)} enchère(s)…`);
      void bidListings(context.api, lines, {
        gapMs: 1_500,
        // Même plafond du jour que les achats directs et les ordres d'achat.
        checkBid: async (line) => spendProblem(await loadDaySpend(), line.maxAmount),
        onBid: async (line, outcome) => {
          await recordAuctionBid(line.id, line.characterId, line.name ?? null, outcome, line.maxAmount);
        },
        onProgress: (done, total, spent) =>
          say(`Mise ${fmt(done)} / ${fmt(total)} · ${fmt(spent)} ◆ engagés`),
      })
        .then((result) => {
          say(
            `Mises : ${fmt(result.bought)} placée(s) · ${fmt(result.spent)} ◆` +
              (result.stop ? ` · arrêt : ${result.stop}` : ''),
          );
          paint();
        })
        .catch((error: unknown) => say(`Mise impossible : ${explainPanelError(error)}`));
    });
    const snipeToggle = h('input', { type: 'checkbox' }) as HTMLInputElement;
    snipeToggle.checked = auction.snipe;
    snipeToggle.addEventListener('change', () => {
      auction.snipe = snipeToggle.checked;
      paint();
    });
    const cancelSnipes = h(
      'button',
      { type: 'button', class: 'kui-secondary kui-auction-cancel-snipes', hidden: !auction.timers.length },
      `Annuler les mises programmées (${fmt(auction.timers.length)})`,
    ) as HTMLButtonElement;
    cancelSnipes.addEventListener('click', () => {
      for (const timer of auction.timers) window.clearTimeout(timer);
      auction.timers = [];
      say('Mises programmées annulées.');
      paint();
    });
    for (const listing of auction.listings.slice(0, 30)) {
      const max = h('input', {
        type: 'number',
        class: 'kui-number-input',
        min: '1',
        value: String(auction.max.get(listing.id) ?? listing.price),
        'aria-label': `Mise maximale pour ${listing.name ?? `la carte #${listing.characterId}`}`,
      }) as HTMLInputElement;
      max.addEventListener('change', () => {
        auction.max.set(listing.id, Math.max(1, Number(max.value) || listing.price));
      });
      rowsHost.append(
        h(
          'div',
          { class: 'kui-data-row' },
          cardThumb(listing.characterId),
          h(
            'div',
            { class: 'kui-row-main' },
            h('b', {}, listing.name ?? `Carte #${listing.characterId}`),
            h(
              'small',
              {},
              `mise ${fmt(listing.price)} ◆ · ${fmt(listing.bids)} mise(s) · ${formatEndsIn(listing.endsAt) ?? 'sans fin'}` +
                (listing.buyout ? ` · achat immédiat ${fmt(listing.buyout)} ◆` : ''),
            ),
          ),
          max,
        ),
      );
    }
    return h(
      'div',
      {},
      h(
        'p',
        { class: 'kui-note' },
        'Mise maximale : Kyara surenchérit pour toi jusqu’à ce plafond. Une mise par enchère, 1,5 s d’écart.',
      ),
      h(
        'div',
        { class: 'kui-buy-tools' },
        h(
          'label',
          {
            class: 'kui-market-check kui-auction-snipe',
            title: 'Attendre la dernière minute pour miser, avec le plafond saisi',
          },
          snipeToggle,
          h('span', {}, 'Miser dans la dernière minute'),
        ),
        search,
        bid,
        cancelSnipes,
      ),
      auction.snipe
        ? h(
            'p',
            { class: 'kui-note' },
            'Mode dernière minute : chaque mise part 60 s avant la fin, au plafond saisi. Les minuteries vivent dans cet onglet ; le fermer annule les mises non parties.',
          )
        : null,
      auction.loaded && !auction.listings.length
        ? h('p', { class: 'kui-note' }, 'Aucune enchère ouverte pour le moment.')
        : rowsHost,
    );
  };

  const ordersBox = (): HTMLElement => {
    const rarity = settingsSelect(
      orders.rarity,
      BUY_RARITIES.map(([value, label]) => [value, label]),
      (value) => {
        orders.rarity = value;
        orders.selected.clear();
        paint();
      },
    );
    const strategies: readonly [typeof orders.strategy, string][] = [
      ['median', 'Médiane 7 j'],
      ['m20', 'Médiane −20 %'],
      ['best1', 'Meilleur ordre +1'],
      ['fixed', 'Fixe ◆'],
    ];
    const fixedInput = h('input', {
      type: 'number',
      min: '1',
      step: '1',
      class: 'kui-number-input kui-order-fixed',
      value: String(orders.fixed),
      'aria-label': 'Prix fixe des ordres, en chakra',
    }) as HTMLInputElement;
    fixedInput.addEventListener('click', (event) => event.stopPropagation());
    fixedInput.addEventListener('change', () => {
      orders.fixed = Math.max(1, Math.round(Number(fixedInput.value) || 1));
      fixedInput.value = String(orders.fixed);
    });
    const strategyBar = h(
      'div',
      { class: 'kui-buy-strategies', role: 'group', 'aria-label': 'Prix des ordres' },
      ...strategies.map(([value, label]) => {
        const button = h(
          'button',
          {
            type: 'button',
            class: `kui-subtab${orders.strategy === value ? ' on' : ''}`,
            'aria-pressed': String(orders.strategy === value),
            'data-strategy': value,
          },
          label,
          value === 'fixed' ? fixedInput : null,
        ) as HTMLButtonElement;
        button.addEventListener('click', () => {
          orders.strategy = value;
          paint();
        });
        return button;
      }),
    );
    const delayMin = h('input', {
      type: 'number',
      min: '1',
      max: '120',
      step: '1',
      class: 'kui-number-input kui-order-delay',
      value: String(orders.dmin),
      'aria-label': 'Délai minimum entre les ordres, en secondes',
    }) as HTMLInputElement;
    const delayMax = h('input', {
      type: 'number',
      min: '1',
      max: '120',
      step: '1',
      class: 'kui-number-input kui-order-delay',
      value: String(orders.dmax),
      'aria-label': 'Délai maximum entre les ordres, en secondes',
    }) as HTMLInputElement;
    const readDelay = (): void => {
      const min = Math.max(1, Math.min(120, Math.round(Number(delayMin.value) || 2)));
      const max = Math.max(min, Math.min(120, Math.round(Number(delayMax.value) || min)));
      orders.dmin = min;
      orders.dmax = max;
      delayMin.value = String(min);
      delayMax.value = String(max);
    };
    delayMin.addEventListener('change', readDelay);
    delayMax.addEventListener('change', readDelay);

    const cardsHost = h('div', { class: 'kui-rows' });
    /** Recâblé après la création des boutons : cocher une carte les active aussitôt. */
    let refreshSelection = (): void => {};
    const visible = data.missing
      .filter((card) => !orders.rarity || card.rarity === orders.rarity)
      .slice(0, 60);
    for (const card of visible) {
      const check = h('input', { type: 'checkbox' }) as HTMLInputElement;
      check.checked = orders.selected.has(card.id);
      check.addEventListener('change', () => {
        if (check.checked) orders.selected.add(card.id);
        else orders.selected.delete(card.id);
        refreshSelection();
      });
      const floor = minPrice(card.rarity);
      const override = orders.overrides.get(card.id);
      const price = h('input', {
        type: 'number',
        min: String(floor),
        step: '1',
        class: 'kui-number-input kui-order-price-input',
        placeholder: override ? String(override) : 'auto',
        value: override ? String(override) : '',
        'aria-label': `Prix de l’ordre pour ${card.name} (minimum ${floor} ◆)`,
      }) as HTMLInputElement;
      price.addEventListener('input', () => {
        if (price.value.trim() === '') {
          orders.overrides.delete(card.id);
          return;
        }
        const value = Math.max(floor, Math.round(Number(price.value) || floor));
        orders.overrides.set(card.id, value);
      });
      cardsHost.append(
        h(
          'div',
          { class: 'kui-data-row' },
          cardThumb(card.id),
          h(
            'div',
            { class: 'kui-row-main' },
            h('b', {}, card.name),
            h('small', {}, `${card.rarity || '?'} · ${card.series || 'sans série'} · min. ${fmt(floor)} ◆`),
          ),
          h('label', { class: 'kui-order-price' }, price, h('span', {}, '◆')),
          check,
        ),
      );
    }
    const selectAllOrders = trustedButton('Tout cocher', () => {
      for (const card of data.missing) {
        if (!orders.rarity || card.rarity === orders.rarity) orders.selected.add(card.id);
      }
      paint();
    });
    const clearOrders = trustedButton('Tout décocher', () => {
      orders.selected.clear();
      paint();
    });
    /**
     * Construit les brouillons (prix auto ou saisi) pour les cartes cochées, avec la
     * médiane connue : la file s'en sert pour trier par marge et signaler une dérive.
     */
    async function buildDrafts(
      ids: readonly number[],
    ): Promise<{ drafts: BuyOrderDraft[]; medians: Map<number, number> }> {
      const fair = await fetchFairPrices(context.api, [...ids]).catch(
        () => new Map<number, number>(),
      );
      const drafts: BuyOrderDraft[] = [];
      const medians = new Map<number, number>();
      for (const card of data.missing) {
        if (!ids.includes(card.id)) continue;
        const floor = minPrice(card.rarity);
        const median = fair.get(card.id) ?? 0;
        if (median > 0) medians.set(card.id, median);
        let price = orders.overrides.get(card.id) ?? 0;
        if (!price) {
          if (orders.strategy === 'fixed') price = orders.fixed;
          else if (!median) price = 0;
          else if (orders.strategy === 'm20') price = Math.floor(median * 0.8);
          else if (orders.strategy === 'best1') {
            const best = await bestBuyBid(context.api, card.id);
            price = best > 0 ? Math.min(best + 1, Math.round(median)) : Math.floor(median * 0.8);
          } else price = Math.round(median);
        }
        price = Math.max(floor, Math.round(price));
        if (price > 0) {
          drafts.push({ characterId: card.id, name: card.name, price, qty: 1 });
        }
      }
      return { drafts, medians };
    }

    const place = guardedButton('Placer les ordres', 'Confirmer', () => {
      const ids = [...orders.selected];
      if (!ids.length) return;
      orders.busy = true;
      say(`Préparation de ${fmt(ids.length)} ordre(s)…`);
      void (async () => {
        const { drafts } = await buildDrafts(ids);
        if (!drafts.length) {
          say('Aucun prix exploitable : relance l’analyse ou choisis une autre stratégie.');
          return;
        }
        const result = await placeBuyOrders(context.api, drafts, {
          gapMs: Math.round(((orders.dmin + orders.dmax) / 2) * 1000),
          onPlaced: (placed, total) =>
            say(`Ordre ${fmt(placed)} / ${fmt(drafts.length)} · ${fmt(total)} ◆ bloqués`),
        });
        say(
          `Ordres : ${fmt(result.placed)} placé(s) · ${fmt(result.total)} ◆` +
            (result.filled ? ` · ${fmt(result.filled)} achat(s) immédiat(s)` : '') +
            (result.stop ? ` · arrêt : ${result.stop}` : '') +
            ' · le reste peut attendre dans la file de l’extension.',
        );
        void context.reload?.();
      })()
        .catch((error: unknown) => say(`Ordres impossibles : ${explainPanelError(error)}`))
        .finally(() => {
          orders.busy = false;
        });
    });


    /** Ajoute la sélection à la file locale : rien n'est envoyé au site ici. */
    const enqueue = trustedButton('Ajouter à la file', () => {
      const ids = [...orders.selected];
      if (!ids.length) return;
      void (async () => {
        const { drafts, medians } = await buildDrafts(ids);
        if (!drafts.length) {
          say('Aucun prix exploitable pour la file : vérifie la stratégie et la rareté.');
          return;
        }
        const next = enqueueOrders(await orderQueueItem.getValue(), drafts, Date.now(), medians);
        await orderQueueItem.setValue(next);
        say(
          `${fmt(drafts.length)} ordre(s) dans la file · ${fmt(next.entries.length)} en attente` +
            ` · ${fmt(queuedTotal(next))} ◆ à engager.`,
        );
        void appendActivity(
          `File d’ordres : ${fmt(drafts.length)} carte(s) ajoutée(s), ${fmt(next.entries.length)} en attente.`,
          'sale',
        );
        await context.reload?.();
      })().catch((error: unknown) => say(`File impossible : ${explainPanelError(error)}`));
    });
    const selectionCount = h(
      'span',
      { class: 'kui-note kui-order-count' },
      `${fmt(orders.selected.size)} carte(s) cochée(s)`,
    );
    refreshSelection = () => {
      const blocked = orders.selected.size === 0 || orders.busy;
      place.disabled = blocked;
      enqueue.disabled = blocked;
      selectionCount.textContent = `${fmt(orders.selected.size)} carte(s) cochée(s)`;
    };
    refreshSelection();

    /** Envoie la file dans la limite des places libres du site (deux vrais clics). */
    const process = guardedButton('Vider la file', 'Confirmer', () => {
      orders.busy = true;
      say('Envoi des ordres en attente…');
      void processOrderQueue(context.api, {
        // La médiane est relue avant l'envoi : un ordre préparé il y a longtemps ne paie
        // pas un prix que le marché a depuis dépassé.
        refreshMedian: async (id) => {
          const snapshot = await fetchPriceSnapshot(context.api, id).catch(() => null);
          return snapshot?.median7d ?? snapshot?.median30d ?? null;
        },
      })
        .then((result) => {
          const bilan = [
            `File : ${fmt(result.placed)} placé(s) · ${fmt(result.total)} ◆`,
            `${fmt(result.remaining)} encore en attente`,
            result.failures.length ? `${fmt(result.failures.length)} refus gardé(s) en file` : '',
            result.nextFreeHint ? `prochaine place ${result.nextFreeHint}` : '',
            result.stop ?? '',
          ].filter(Boolean);
          say(bilan.join(' · '));
          return context.reload?.();
        })
        .catch((error: unknown) => say(`File impossible : ${explainPanelError(error)}`))
        .finally(() => {
          orders.busy = false;
        });
    });

    process.disabled = data.queue.length === 0;

    const queueBox = h('div', { class: 'kui-rows kui-order-queue' });
    const writeQueue = (next: ReturnType<typeof moveQueuedOrder>, message: string): void => {
      void orderQueueItem
        .setValue(next)
        .then(() => {
          say(message);
          return context.reload?.();
        })
        .catch(() => say('Mise à jour de la file impossible.'));
    };
    if (!data.queue.length) {
      queueBox.append(
        h('p', { class: 'kui-note' }, 'File vide : coche des cartes puis « Ajouter à la file ».',
        ),
      );
    }
    const queueNow = Date.now();
    for (const [index, entry] of data.queue.entries()) {
      const move = (delta: number, label: string): HTMLButtonElement => {
        const button = h(
          'button',
          { type: 'button', class: 'kui-secondary kui-order-move', 'aria-label': label },
          delta < 0 ? '↑' : '↓',
        ) as HTMLButtonElement;
        button.disabled = delta < 0 ? index === 0 : index === data.queue.length - 1;
        button.title = label;
        button.addEventListener('click', () =>
          writeQueue(
            moveQueuedOrder({ entries: [...data.queue] }, entry.characterId, delta),
            `${entry.name ?? `Carte #${entry.characterId}`} : position ${index + 1 + delta} dans la file.`,
          ),
        );
        return button;
      };
      const remove = h(
        'button',
        { type: 'button', class: 'kui-secondary' },
        'Retirer',
      ) as HTMLButtonElement;
      remove.addEventListener('click', () => {
        void orderQueueItem
          .setValue(removeQueuedOrders({ entries: [...data.queue] }, [entry.characterId]))
          .then(() => context.reload?.())
          .catch(() => say('Retrait de la file impossible.'));
      });
      const warnings = queueWarnings(entry, queueNow);
      const medianNote = entry.median ? ` · médiane ${fmt(entry.median)} ◆` : '';
      queueBox.append(
        h(
          'div',
          { class: 'kui-data-row kui-order-row' },
          cardThumb(entry.characterId),
          h(
            'div',
            { class: 'kui-row-main' },
            h('b', {}, entry.name ?? `Carte #${entry.characterId}`),
            h(
              'small',
              {},
              `×${fmt(entry.qty)} à ${fmt(entry.price)} ◆ = ${fmt(entry.price * entry.qty)} ◆${medianNote}`,
            ),
            // Motif du dernier refus, lisible ligne par ligne : une entrée refusée ne
            // bloque plus les suivantes, elle attend son délai de reprise.
            entry.error ? h('small', { class: 'kui-order-error' }, entry.error) : null,
            warnings.length ? h('small', { class: 'kui-order-warn' }, warnings.join(' · ')) : null,
          ),
          h('div', { class: 'kui-order-move-group' }, move(-1, 'Monter dans la file'), move(1, 'Descendre dans la file'), remove),
        ),
      );
    }
    const sortQueue = trustedButton('Trier par marge', () => {
      writeQueue(
        sortQueueByMargin({ entries: [...data.queue] }),
        'File triée par marge (médiane − prix), les cartes sans médiane à la fin.',
      );
    });
    sortQueue.disabled = data.queue.length < 2;

    // Dépenses du jour : ordres et achats directs partagent le même compteur et le même plafond.
    const spendNote = h('p', { class: 'kui-note kui-order-spend' }, 'Dépenses du jour : lecture…');
    void (async () => {
      const [purchases, plan, history] = await Promise.all([
        purchasesItem.getValue().catch(() => null),
        buyPlanItem.getValue().catch(() => null),
        buyOrdersItem.getValue().catch(() => null),
      ]);
      const spend = daySpend({
        purchases: normalizePurchases(purchases),
        orders: normalizeBuyOrders(history).entries,
        plan: normalizeBuyPlan(plan),
      });
      spendNote.textContent =
        `Dépenses du jour : ${fmt(spend.total)} ◆ ` +
        `(${fmt(spend.orders)} ◆ ordres · ${fmt(spend.purchases)} ◆ achats` +
        (spend.auctions ? ` · ${fmt(spend.auctions)} ◆ enchères en tête` : '') +
        ')' +
        (spend.limit !== null ? ` sur ${fmt(spend.limit)} ◆ engagés au plus.` : '.');
    })();

    const freeSlots = Math.max(0, data.ordersLimit - data.orders.length);
    const queueHeading = h(
      'h3',
      { class: 'kui-section-title' },
      `File d’attente de l’extension (${fmt(data.queue.length)})`,
    );

    const openOrders = h('div', { class: 'kui-rows' });
    for (const order of data.orders) {
      const cancel = guardedButton('Annuler', 'Confirmer', () =>
        void context
          .perform(
            `Annulation de l’ordre sur ${order.name ?? `la carte #${order.characterId}`}…`,
            async () => {
              await cancelBuyOrder(context.api, order.id);
              return 'Ordre annulé.';
            },
          )
          .then(() => context.reload?.()),
      );
      openOrders.append(
        h(
          'div',
          { class: 'kui-data-row' },
          cardThumb(order.characterId),
          h(
            'div',
            { class: 'kui-row-main' },
            h('b', {}, order.name ?? `Carte #${order.characterId}`),
            h(
              'small',
              {},
              `${fmt(order.price)} ◆ · ${fmt(Math.max(0, order.qty - order.filled))} restante(s) · ${order.status}`,
            ),
          ),
          cancel,
        ),
      );
    }
    const openHeading = h(
      'h3',
      { class: 'kui-section-title' },
      `Mes ordres ouverts (${fmt(data.orders.length)})`,
    );
    const openJump = h(
      'button',
      { type: 'button', class: 'kui-secondary' },
      'Mes ordres ouverts',
    ) as HTMLButtonElement;
    openJump.addEventListener('click', () =>
      openHeading.scrollIntoView({ block: 'start', behavior: 'smooth' }),
    );
    return h(
      'div',
      {},
      h(
        'p',
        { class: 'kui-note' },
        `Cartes manquantes du catalogue : coche-en autant que tu veux, choisis le prix par carte (ou laisse « auto »), puis ajoute-les à la file. Kyara limite les ordres ouverts (${fmt(data.ordersLimit)} pour ton compte) et refuse le reste : la file de l’extension garde les autres en local et les envoie dès qu’une place se libère. Jamais sous le minimum de la rareté (15 ◆ dès Épique) ; le chakra est bloqué tant que l’ordre est ouvert.`,
      ),
      h(
        'p',
        { class: 'kui-note kui-order-limit' },
        `${fmt(data.orders.length)} / ${fmt(data.ordersLimit)} ordre(s) ouvert(s) · ` +
          `${fmt(freeSlots)} place(s) libre(s) · ${fmt(data.queue.length)} en file · ` +
          `${fmt(queuedTotal({ entries: [...data.queue] }))} ◆ à engager` +
          (data.queue.length && freeSlots === 0
            ? ' · la file attend qu’un ordre se remplisse ou soit annulé.'
            : ''),
      ),
      h(
        'div',
        { class: 'kui-buy-tools' },
        settingsField('Rareté', rarity),
        openJump,
        selectAllOrders,
        clearOrders,
      ),
      h('div', { class: 'kui-field kui-order-prices' }, h('span', {}, 'Prix des ordres'), strategyBar),
      h(
        'div',
        { class: 'kui-buy-tools' },
        settingsField('Délai entre les ordres', h('span', { class: 'kui-order-delay-range' }, delayMin, h('span', {}, '–'), delayMax, h('span', {}, 's'))),
        place,
        enqueue,
        selectionCount,
      ),
      cardsHost,
      queueHeading,
      h(
        'p',
        { class: 'kui-note' },
        'La file est locale et persiste : rien n’est perdu si tu fermes le panneau. « Vider la file » envoie les premiers ordres dans les places libres, après deux vrais clics ; le reste attend la prochaine place.',
      ),
      queueBox,
      h('div', { class: 'kui-buy-actions' }, process, sortQueue),
      spendNote,
      openHeading,
      data.orders.length
        ? openOrders
        : h('p', { class: 'kui-note' }, 'Aucun ordre d’achat ouvert.'),
    );
  };

  function paint(): void {
    host.replaceChildren(
      tab === 'fixed' ? fixedBox() : tab === 'auction' ? auctionBox() : ordersBox(),
    );
    for (const button of segments.querySelectorAll('button')) {
      const on = button.dataset.buytab === tab;
      button.classList.toggle('on', on);
      button.setAttribute('aria-selected', String(on));
    }
  }

  segments.replaceChildren(
    ...(Object.keys(LABELS) as BuyTab[]).map((key) => {
      const button = h(
        'button',
        { type: 'button', class: 'kui-subtab', role: 'tab', 'data-buytab': key },
        LABELS[key],
      ) as HTMLButtonElement;
      button.addEventListener('click', () => {
        tab = key;
        paint();
      });
      return button;
    }),
  );

  paint();
  return h(
    'div',
    { class: 'kui-buy-view' },
    metrics([
      ['Cartes manquantes', fmt(data.missing.length)],
      ['Ordres ouverts', fmt(data.orders.length)],
      ['Limite du site', fmt(data.ordersLimit)],
      ['En file', fmt(data.queue.length)],
    ]),
    segments,
    status,
    host,
  );
}

function wishesContent(
  data: PanelWishData,
  context: ViewContext,
  state: WishSearchState,
): HTMLElement {
  const wishSet = new Set(data.wishIds);
  const input = h('input', {
    type: 'search',
    class: 'kui-search-input',
    placeholder: 'Rechercher une carte…',
    'aria-label': 'Rechercher une carte à ajouter aux envies',
  }) as HTMLInputElement;
  input.value = state.query;
  const results = h('div', { class: 'kui-search-results' });

  const paintResults = (): void => {
    const query = state.query.trim().toLowerCase();
    if (query.length < 2) {
      results.replaceChildren(
        h(
          'p',
          { class: 'kui-note' },
          'Tape au moins deux caractères pour chercher dans le catalogue.',
        ),
      );
      return;
    }
    const matches = data.catalog
      .filter(
        (card) =>
          card.name && !wishSet.has(Number(card.id)) && card.name.toLowerCase().includes(query),
      )
      .sort((a, b) => String(a.name).localeCompare(String(b.name), 'fr'))
      .slice(0, 6);
    if (!matches.length) {
      results.replaceChildren(h('p', { class: 'kui-note' }, 'Aucune carte trouvée.'));
      return;
    }
    results.replaceChildren(
      ...matches.map((card) => {
        const id = Number(card.id);
        const name = card.name ?? `Carte #${id}`;
        const add = guardedButton('Ajouter', 'Confirmer', () =>
          context.perform(`Ajout de ${name}…`, async () => {
            await gameActions.addWish(context.api, id);
            void appendActivity(`${name} ajoutée à tes envies.`, 'sale');
            return `${name} ajoutée à tes envies.`;
          }),
        );
        return actionRow(
          name,
          [card.rarity, card.series].filter(Boolean).join(' · ') || 'Carte du catalogue',
          add,
          id,
        );
      }),
    );
  };

  input.addEventListener('input', () => {
    state.query = input.value;
    paintResults();
  });
  paintResults();
  const marketLauncher = h(
    'button',
    { type: 'button', class: 'kui-secondary kui-market-launch' },
    'Chercher dans le marché',
  ) as HTMLButtonElement;
  marketLauncher.addEventListener('click', () => {
    openMarketSearchPanel(context.api);
  });
  const clearButton = guardedButton('Vider la liste', 'Confirmer', () =>
    context.perform('Vidage de la liste d’envies…', async () => {
      const result = await clearWishes(context.api);
      void appendActivity(`${fmt(result.removed)} carte(s) retirée(s) de tes envies.`, 'sale');
      return result.stop
        ? `${fmt(result.removed)} carte(s) retirée(s) · arrêt : ${result.stop}`
        : `Liste d’envies vidée (${fmt(result.removed)} carte(s)).`;
    }),
  );
  clearButton.disabled = data.count === 0;
  clearButton.title = 'Retire toutes les cartes de ta liste d’envies, après deux vrais clics';
  clearButton.classList.add('kui-wish-clear');

  return h(
    'div',
    {},
    metrics([
      ['Envies', fmt(data.count)],
      ['Catalogue connu', fmt(data.catalogSize)],
    ]),
    h('label', { class: 'kui-search' }, input),
    h('h3', { class: 'kui-section-title' }, 'Ajouter une carte'),
    results,
    h('h3', { class: 'kui-section-title' }, 'Ma liste'),
    data.cards.length
      ? list(
          data.cards.map((card) =>
            row(
              card.name,
              [card.rarity, card.series].filter(Boolean).join(' · ') || 'Carte du catalogue',
              '★',
              card.id,
            ),
          ),
        )
      : h('p', { class: 'kui-note' }, 'Ta liste d’envies est vide pour le moment.'),
    data.count > data.cards.length
      ? h(
          'p',
          { class: 'kui-note' },
          `+ ${fmt(data.count - data.cards.length)} autre(s) carte(s) non affichée(s) dans l’aperçu.`,
        )
      : null,
    h('div', { class: 'kui-quick-actions' }, marketLauncher, clearButton),
    h(
      'p',
      { class: 'kui-note' },
      'La recherche détaillée s’ouvre dans le panneau secondaire à gauche ; la version repliée ci-dessous reste disponible sans quitter l’onglet. « Vider la liste » retire toutes les envies, carte par carte, après confirmation.',
    ),
    h(
      'details',
      { class: 'kui-market-fold' },
      h('summary', {}, 'Recherche avancée dans le marché'),
      marketSearchBox(data, context, state),
    ),
  );
}

/** Lignes affichées au plus : le reste est plus cher, il n'est pas listé. */
/** Dépense du jour, servie par les mêmes caches que la vue Achat (aucune requête). */
async function loadDaySpend(): Promise<DaySpend> {
  const [purchases, plan, history] = await Promise.all([
    purchasesItem.getValue().catch(() => null),
    buyPlanItem.getValue().catch(() => null),
    buyOrdersItem.getValue().catch(() => null),
  ]);
  return daySpend({
    purchases: normalizePurchases(purchases),
    orders: normalizeBuyOrders(history).entries,
    plan: normalizeBuyPlan(plan),
  });
}

/** Ajoute un achat direct au compteur partagé (ordres + achats). */
async function recordPurchaseEntry(entry: {
  characterId: number;
  name: string | null;
  price: number;
  kind: 'listing' | 'auction';
  /** Enchère : une seule ligne par annonce, mise à jour à chaque mise. */
  listingId?: string;
  /** Enchère en tête, pas encore gagnée : compte dans le plafond, pas dans les achats. */
  pending?: boolean;
}): Promise<void> {
  const purchases = normalizePurchases(await purchasesItem.getValue().catch(() => null));
  await purchasesItem.setValue(addPurchase(purchases, entry)).catch(() => undefined);
}

const MARKET_ROWS_SHOWN = 60;

/** Pause entre deux ajouts groupés : le site coupe l'accès après une rafale. */
const WISH_ADD_DELAY_MS = 700;

const MARKET_SORTS: readonly { value: 'newest' | 'ending'; label: string }[] = [
  { value: 'newest', label: 'Plus récentes' },
  { value: 'ending', label: 'Fin imminente' },
];

const MARKET_RARITIES: readonly { value: string; label: string }[] = [
  { value: '', label: 'Toutes raretés' },
  { value: 'C', label: 'Commune' },
  { value: 'U', label: 'Peu commune' },
  { value: 'R', label: 'Rare' },
  { value: 'E', label: 'Épique' },
  { value: 'L', label: 'Légendaire' },
  { value: 'M', label: 'Mythique' },
];

function marketCheck(
  label: string,
  checked: boolean,
  onChange: (value: boolean) => void,
): HTMLElement {
  const input = h('input', { type: 'checkbox' }) as HTMLInputElement;
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));
  return h('label', { class: 'kui-market-check' }, input, label);
}

/**
 * Une annonce du marché : le contenu ouvre l'annonce du site dans un nouvel onglet,
 * et une action facultative (ajout aux envies) reste hors du lien.
 */
function marketRow(
  listing: MarketListing,
  wishSet: ReadonlySet<number>,
  owned: boolean,
  actions?: HTMLElement,
  open?: (listing: MarketListing) => void,
): HTMLElement {
  const discount = listingDiscount(listing);
  const detail = [
    listing.series,
    listing.auction
      ? listing.buyout
        ? `enchère · achat immédiat ${fmt(listing.buyout)} ◆`
        : 'enchère'
      : 'prix fixe',
    formatEndsIn(listing.endsAt),
    discount === null
      ? 'médiane inconnue'
      : `${discount < 0 ? '−' : '+'}${fmt(Math.abs(discount))} % méd.`,
    listing.seller,
  ]
    .filter(Boolean)
    .join(' · ');
  const anchor = h(
      'a',
      {
        class: 'kui-market-row kui-market-open',
        href: `https://kyara.games/marche?annonce=${encodeURIComponent(listing.id)}`,
        target: '_blank',
        rel: 'noopener',
      },
      cardThumb(listing.characterId),
      h(
        'div',
        { class: 'kui-row-main' },
        h(
          'b',
          {},
          `${wishSet.has(listing.characterId) ? '★ ' : ''}${listing.name ?? `Carte #${listing.characterId}`}`,
        ),
        h('small', {}, detail),
      ),
      h('span', { class: 'kui-chip' }, `${fmt(listing.price)} ◆`),
      // Une carte possédée n'a pas de bouton : le tag dit pourquoi.
      owned ? h('span', { class: 'kui-chip kui-market-owned' }, 'possédée') : null,
  );
  // Ouvrir l'annonce est le seul geste suivi : il alimente le journal local.
  if (open) anchor.addEventListener('click', () => open(listing));
  return h('div', { class: 'kui-data-row kui-market-row-wrap' }, anchor, actions ?? null);
}

/**
 * Recherche dans tout le marché : lecture paginée (48 annonces, 8 pages, 600 ms
 * d'écart), puis tri par écart à la médiane. Aucune écriture : le catalogue et la
 * wishlist ne sont pas modifiés, seuls les liens ouvrent l'annonce du site.
 */
function marketSearchBox(
  data: PanelWishData,
  context: ViewContext,
  state: WishSearchState,
): HTMLElement {
  const wishSet = new Set(data.wishIds);
  // « Mes envies » cherche chaque carte par son nom : le catalogue donne les
  // noms, la wishlist dit lesquelles chercher.
  const wishRefs: WishCardRef[] = [];
  for (const card of data.catalog) {
    const id = Number(card.id);
    const name = card.name?.trim();
    if (!name || !wishSet.has(id)) continue;
    wishRefs.push({
      id,
      name,
      series: card.series ?? null,
      rarity: card.rarity ?? null,
      median: data.medians.get(id) ?? null,
    });
  }
  // Cartes possédées : le site refuse de les mettre en envie (`wish_owned`). La
  // possession lue dans la collection comme celle découverte par un refus vivent dans
  // l'état, car le panneau reconstruit ses vues après chaque action.
  const blocked = state.owned;
  for (const id of data.ownedIds) blocked.add(id);
  // Une passe ne lit que 20 envies : les plus précieuses passent en premier.
  wishRefs.splice(0, wishRefs.length, ...prioritizeWishCards(wishRefs));
  let adding = false;
  /** Annulation de la lecture en cours, pour le bouton « Arrêter » du mode envies. */
  let searchAbort: AbortController | null = null;
  const unnamed = data.wishIds.length - wishRefs.length;
  const rows = h('div', { class: 'kui-rows kui-market-rows' });
  const status = h('p', { class: 'kui-note kui-market-status', role: 'status' });
  const moreRows = h(
    'button',
    { type: 'button', class: 'kui-secondary kui-market-more', hidden: true },
    'Afficher plus',
  ) as HTMLButtonElement;
  moreRows.addEventListener('click', () => {
    state.marketShown += MARKET_ROWS_SHOWN;
    paint();
  });

  /** Retient une carte que le site refuse (`wish_owned`) et cesse de la proposer. */
  function refuseWish(id: number): void {
    blocked.add(id);
    void rememberOwned([id]);
    paintCard(id);
  }

  /** Ajoute une carte aux envies cherchables par nom, quand le catalogue la connaît. */
  function pushWishRef(id: number): void {
    if (wishRefs.some((card) => card.id === id)) return;
    const card = data.catalog.find((item) => Number(item.id) === id);
    if (!card?.name) return;
    wishRefs.push({
      id,
      name: card.name,
      series: card.series ?? null,
      rarity: card.rarity ?? null,
      median: data.medians.get(id) ?? null,
    });
  }

  function dropWishRef(id: number): void {
    const index = wishRefs.findIndex((card) => card.id === id);
    if (index >= 0) wishRefs.splice(index, 1);
  }

  /** Ajout à la wishlist depuis un résultat : écriture de jeu, deux vrais clics. */
  function addButton(listing: MarketListing): HTMLButtonElement {
    const name = listing.name ?? `Carte #${listing.characterId}`;
    const button = guardedButton('★ Ajouter', 'Confirmer', () =>
      context.perform(`Ajout de ${name} à tes envies…`, async () => {
        try {
          await gameActions.addWish(context.api, listing.characterId);
        } catch (error) {
          if (error instanceof ApiError && error.code === 'wish_owned') {
            refuseWish(listing.characterId);
            return `${name} est déjà possédée : elle ne peut pas rejoindre tes envies.`;
          }
          throw error;
        }
        wishSet.add(listing.characterId);
        pushWishRef(listing.characterId);
        void appendActivity(`${name} ajoutée à tes envies.`, 'sale');
        paintCard(listing.characterId);
        return `${name} ajoutée à tes envies.`;
      }),
    );
    button.classList.add('kui-market-add');
    button.setAttribute('aria-label', 'Ajouter à mes envies');
    button.title = 'Ajouter à mes envies';
    return button;
  }

  /** Achat direct de l'annonce : deux vrais clics, jamais d'achat automatique. */
  function buyButton(listing: MarketListing): HTMLButtonElement | null {
    const price = listing.auction ? listing.buyout : listing.price;
    if (!price || price <= 0) return null;
    const name = listing.name ?? `Carte #${listing.characterId}`;
    const button = guardedButton(`Acheter ${fmt(price)} ◆`, 'Confirmer l’achat', () =>
      context.perform(`Achat de ${name} pour ${fmt(price)} ◆…`, async () => {
        // Même plafond du jour que les ordres : les deux vues ne racontent plus deux comptes.
        const refus = spendProblem(await loadDaySpend(), price);
        if (refus) return refus;
        const outcome = await buyListing(context.api, listing.id);
        if (!outcome.ok) return `Achat refusé : ${outcome.message}`;
        await recordPurchaseEntry({
          characterId: listing.characterId,
          name,
          price: outcome.paid ?? price,
          kind: listing.auction ? 'auction' : 'listing',
          // Même annonce qu'une mise en attente : l'achat immédiat la remplace, sans doublon.
          listingId: listing.id,
        });
        blocked.add(listing.characterId);
        void rememberOwned([listing.characterId]);
        void appendActivity(`${name} achetée pour ${fmt(outcome.paid ?? price)} ◆.`, 'sale');
        paintCard(listing.characterId);
        return outcome.message;
      }),
    );
    button.classList.add('kui-market-buy');
    button.setAttribute('aria-label', `Acheter ${name}`);
    button.title = `Acheter ${name} pour ${fmt(price)} ◆`;
    return button;
  }

  /** Symétrie de l'ajout : retirer une carte déjà en envies, deux vrais clics. */
  function removeButton(listing: MarketListing): HTMLButtonElement {
    const name = listing.name ?? `Carte #${listing.characterId}`;
    const button = guardedButton('Retirer', 'Confirmer', () =>
      context.perform(`Retrait de ${name} de tes envies…`, async () => {
        await gameActions.removeWish(context.api, listing.characterId);
        wishSet.delete(listing.characterId);
        dropWishRef(listing.characterId);
        void appendActivity(`${name} retirée de tes envies.`, 'sale');
        paintCard(listing.characterId);
        return `${name} retirée de tes envies.`;
      }),
    );
    button.classList.add('kui-secondary', 'kui-market-remove');
    button.setAttribute('aria-label', 'Retirer de mes envies');
    button.title = 'Retirer de mes envies';
    return button;
  }

  /** Cartes des lignes affichées qui peuvent encore rejoindre les envies, sans doublon. */
  function pendingAdds(): MarketListing[] {
    const result = state.result;
    if (!result?.listings.length) return [];
    const seen = new Set<number>();
    const targets: MarketListing[] = [];
    for (const listing of result.listings.slice(0, state.marketShown)) {
      const id = listing.characterId;
      if (wishSet.has(id) || blocked.has(id) || seen.has(id)) continue;
      seen.add(id);
      targets.push(listing);
    }
    return targets;
  }

  /** Ce que porte la ligne à droite : retrait, ajout, ou rien pour une carte possédée. */
  function rowActions(listing: MarketListing): HTMLElement {
    const action = wishSet.has(listing.characterId)
      ? removeButton(listing)
      : blocked.has(listing.characterId)
        ? null
        : addButton(listing);
    const buy = blocked.has(listing.characterId) ? null : buyButton(listing);
    return h('div', { class: 'kui-market-actions' }, action, buy);
  }

  /** Ajout groupé des lignes affichées, une écriture à la fois, arrêt sur limite. */
  async function addAll(): Promise<void> {
    const targets = pendingAdds();
    if (!targets.length) return;
    adding = true;
    paint();
    try {
      await context.perform(`Ajout de ${fmt(targets.length)} envie(s)…`, async () => {
        let added = 0;
        let owned = 0;
        let failed = 0;
        let stopped = false;
        for (const [index, listing] of targets.entries()) {
          context.setStatus(`Ajout ${fmt(index + 1)}/${fmt(targets.length)}…`);
          // Une carte déjà ajoutée pendant la boucle n'est pas écrasée par un doublon.
          if (wishSet.has(listing.characterId)) continue;
          try {
            await gameActions.addWish(context.api, listing.characterId);
            wishSet.add(listing.characterId);
            pushWishRef(listing.characterId);
            added += 1;
            paintCard(listing.characterId);
          } catch (error) {
            if (error instanceof ApiError && error.code === 'wish_owned') {
              blocked.add(listing.characterId);
              void rememberOwned([listing.characterId]);
              owned += 1;
              paintCard(listing.characterId);
            } else if (error instanceof ApiError && error.code === 'rate_limited') {
              stopped = true;
              break;
            } else {
              failed += 1;
            }
          }
          if (index < targets.length - 1) {
            await new Promise<void>((resolve) => setTimeout(resolve, WISH_ADD_DELAY_MS));
          }
        }
        if (added) void appendActivity(`${fmt(added)} carte(s) ajoutée(s) à tes envies.`, 'sale');
        const bilan = [
          `${fmt(added)} ajoutée(s)`,
          owned ? `${fmt(owned)} déjà possédée(s)` : '',
          failed ? `${fmt(failed)} échec(s)` : '',
        ]
          .filter(Boolean)
          .join(' · ');
        return stopped
          ? `${bilan} · interrompu : le site limite les requêtes, reprends plus tard.`
          : bilan;
      });
    } finally {
      adding = false;
      paint();
    }
  }

  const text = h('input', {
    type: 'search',
    class: 'kui-search-input',
    placeholder: 'Nom du perso (facultatif)',
    'aria-label': 'Nom du perso à chercher dans le marché',
    autocomplete: 'off',
  }) as HTMLInputElement;
  text.value = state.market.text;
  text.addEventListener('input', () => {
    state.market.text = text.value;
  });

  const series = h('input', {
    type: 'search',
    class: 'kui-search-input',
    placeholder: 'Univers / album (facultatif)',
    'aria-label': 'Univers à chercher dans le marché',
    autocomplete: 'off',
  }) as HTMLInputElement;
  series.value = state.market.series;
  series.addEventListener('input', () => {
    state.market.series = series.value;
  });

  const rarity = h('select', {
    class: 'kui-search-input kui-select',
    'aria-label': 'Rareté recherchée dans le marché',
  }) as HTMLSelectElement;
  for (const option of MARKET_RARITIES) rarity.append(h('option', { value: option.value }, option.label));
  rarity.value = state.market.rarity;
  rarity.addEventListener('change', () => {
    state.market.rarity = rarity.value;
  });

  const sort = h('select', {
    class: 'kui-search-input kui-select',
    'aria-label': 'Tri des annonces du marché',
  }) as HTMLSelectElement;
  for (const option of MARKET_SORTS) sort.append(h('option', { value: option.value }, option.label));
  sort.value = state.market.sort;
  sort.addEventListener('change', () => {
    state.market.sort = sort.value === 'ending' ? 'ending' : 'newest';
  });

  const minDiscount = h('input', {
    type: 'number',
    min: '0',
    max: '100',
    step: '5',
    class: 'kui-search-input kui-market-discount',
    placeholder: '0',
    'aria-label': 'Réduction minimale sous la médiane, en pourcentage',
  }) as HTMLInputElement;
  minDiscount.value = state.market.minDiscount ? String(state.market.minDiscount) : '';
  minDiscount.addEventListener('input', () => {
    state.market.minDiscount = Math.max(0, Math.min(100, parseInt(minDiscount.value, 10) || 0));
    paint();
  });

  // Champ sans libellé visible au départ : « Au moins − 20 % méd. » se lit d'un coup d'œil.
  const discountField = h(
    'label',
    { class: 'kui-market-discount-field' },
    h('span', {}, 'Au moins −'),
    minDiscount,
    h('span', {}, '% méd.'),
  );

  const noAuction = marketCheck('Sans enchères', state.market.noAuction, (checked) => {
    state.market.noAuction = checked;
    paint();
  });
  const wishOnly = marketCheck('★ Mes envies', state.market.wishOnly, (checked) => {
    state.market.wishOnly = checked;
    paint();
  });
  const missingOnly = marketCheck('Cartes manquantes', state.market.missing, (checked) => {
    state.market.missing = checked;
    paint();
  });
  const buyNowOnly = marketCheck('Achat immédiat', state.market.buyNow, (checked) => {
    state.market.buyNow = checked;
    paint();
  });
  const hideOwnedBox = marketCheck('Masquer les possédées', state.market.hideOwned, (checked) => {
    state.market.hideOwned = checked;
    state.marketShown = MARKET_ROWS_SHOWN;
    paint();
  });

  const submit = h('button', { type: 'button', class: 'kui-action' }, 'Chercher') as HTMLButtonElement;
  submit.addEventListener('click', () => void run());
  const more = h(
    'button',
    { type: 'button', class: 'kui-action', hidden: true },
    'Lire la suite',
  ) as HTMLButtonElement;
  more.addEventListener('click', () => void run(true));
  const stop = h(
    'button',
    { type: 'button', class: 'kui-secondary kui-market-stop', hidden: true },
    'Arrêter',
  ) as HTMLButtonElement;
  stop.addEventListener('click', () => stopSearch());
  // Veilles de prix : plusieurs veilles nommées, chacune avec ses critères figés, son
  // intervalle et ses annonces déjà signalées. Une veille tourne aussi sans le panneau
  // ouvert (content script, sous Web Lock) ; ici on la crée, la modifie et la déclenche.
  let watchBook: MarketWatchBook = { watches: [] };
  let watchBusy = false;
  const watchName = h('input', {
    type: 'search',
    class: 'kui-search-input kui-market-watch-name',
    placeholder: 'Nom de la veille (facultatif)',
    'aria-label': 'Nom de la nouvelle veille de prix',
    autocomplete: 'off',
  }) as HTMLInputElement;
  const watchCreate = h(
    'button',
    { type: 'button', class: 'kui-secondary kui-market-watch-create' },
    'Créer une veille',
  ) as HTMLButtonElement;
  const watchList = h('div', { class: 'kui-market-watches' });
  const watchStatus = h('p', { class: 'kui-note kui-market-watch-status', role: 'status' });

  /** Critères retenus pour la veille : ceux saisis au moment de l'activation. */
  function criteriaFromState(): MarketWatchConfig['criteria'] {
    return {
      text: state.market.text,
      series: state.market.series,
      rarity: state.market.rarity,
      wishOnly: state.market.wishOnly,
      noAuction: state.market.noAuction,
      minDiscount: state.market.minDiscount,
      buyNow: state.market.buyNow,
      missing: state.market.missing,
    };
  }

  /** Résumé d'une veille : état, échéance et dernières alertes. */
  function watchSummary(watch: MarketWatchConfig): string {
    if (!watch.enabled) return 'Coupée.';
    if (watch.lastError) return `En échec : ${watch.lastError}`;
    if (!watch.at) return 'Jamais lancée.';
    const parts = [`Passe ${atLabel(watch.at)} · ${fmt(watch.lastAlerts)} alerte(s).`];
    if (watch.retryAt > Date.now()) parts.push(`Pause jusqu’à ${atLabel(watch.retryAt)}.`);
    return parts.join(' ');
  }

  async function saveBook(next: MarketWatchBook, message = ''): Promise<void> {
    watchBook = next;
    try {
      await saveWatchBook(next);
    } catch {
      // Un stockage en échec laisse la liste affichée telle quelle.
    }
    if (message) context.setStatus(message);
    paintWatch();
  }

  function paintWatch(): void {
    watchCreate.disabled = watchBusy || watchBook.watches.length >= MARKET_WATCH_MAX;
    watchStatus.textContent = watchBook.watches.length
      ? `${fmt(watchBook.watches.filter((watch) => watch.enabled).length)} veille(s) active(s) sur ${fmt(watchBook.watches.length)} · ${fmt(MARKET_WATCH_MAX)} au plus.`
      : 'Aucune veille : choisis des critères puis « Créer une veille ».';
    watchList.replaceChildren(
      ...watchBook.watches.map((watch) => {
        const toggle = h('input', { type: 'checkbox' }) as HTMLInputElement;
        toggle.checked = watch.enabled;
        toggle.disabled = watchBusy;
        toggle.addEventListener('change', () =>
          void saveBook(
            patchWatch(watchBook, watch.id, { enabled: toggle.checked }),
            `${watch.label} : ${toggle.checked ? 'veille active' : 'veille coupée'}.`,
          ),
        );
        const every = h('select', {
          class: 'kui-search-input kui-select kui-market-watch-every',
          'aria-label': `Intervalle de la veille ${watch.label}`,
        }) as HTMLSelectElement;
        for (const minutes of MARKET_WATCH_INTERVALS_MIN) {
          every.append(h('option', { value: String(minutes) }, `${minutes} min`));
        }
        every.value = String(Math.round(watch.intervalMs / 60_000));
        every.disabled = watchBusy;
        every.addEventListener('change', () =>
          void saveBook(
            patchWatch(watchBook, watch.id, { intervalMs: Number(every.value) * 60_000 }),
            `${watch.label} : toutes les ${every.value} min.`,
          ),
        );
        const once = h(
          'button',
          { type: 'button', class: 'kui-secondary kui-market-watch-now' },
          'Veiller maintenant',
        ) as HTMLButtonElement;
        once.disabled = watchBusy;
        once.addEventListener('click', () => void watchOnce(watch.id));
        const drop = h(
          'button',
          { type: 'button', class: 'kui-secondary kui-market-watch-drop' },
          'Supprimer',
        ) as HTMLButtonElement;
        drop.disabled = watchBusy;
        drop.addEventListener('click', () =>
          void saveBook(removeWatch(watchBook, watch.id), `${watch.label} supprimée.`),
        );
        return h(
          'div',
          { class: 'kui-market-watch-row', 'data-watch': watch.id },
          h('div', { class: 'kui-row-main' },
            h('b', {}, watch.label),
            h('small', {}, watchSummary(watch)),
          ),
          h('div', { class: 'kui-market-watch-tools' },
            h('label', { class: 'kui-market-check' }, toggle, h('span', {}, 'Active')),
            every,
            once,
            drop,
          ),
        );
      }),
    );
  }

  async function watchOnce(id: string): Promise<void> {
    if (watchBusy) return;
    watchBusy = true;
    paintWatch();
    try {
      const result = await runMarketWatchBook({
        api: context.api,
        force: true,
        onlyId: id,
        loadBook: async () => watchBook,
        saveBook: async (next) => {
          watchBook = next;
          await saveWatchBook(next);
        },
      });
      const run = result.runs[0];
      if (run?.ok) {
        context.setStatus(`Veille : ${fmt(run.alerts)} alerte(s) sur ${fmt(run.listings)} annonce(s).`);
      } else if (run?.skipped === 'no-criteria') {
        context.setStatus('Aucune envie nommée à chercher : décoche « ★ Mes envies » ou choisis des critères.');
      } else if (run && !run.skipped) {
        context.setStatus(`Veille impossible : ${run.error ?? 'réessaie plus tard'}`);
      }
    } finally {
      watchBusy = false;
      paintWatch();
    }
  }

  watchCreate.addEventListener('click', () => {
    if (watchBook.watches.length >= MARKET_WATCH_MAX) {
      context.setStatus(`Veille : ${fmt(MARKET_WATCH_MAX)} au plus, supprime-en une.`);
      return;
    }
    const criteria = criteriaFromState();
    const label =
      watchName.value.trim() ||
      (criteria.wishOnly
        ? 'Mes envies'
        : criteria.text
          ? criteria.text
          : criteria.rarity
            ? `Rareté ${criteria.rarity}`
            : 'Marché');
    const watch = newWatch(criteria, label);
    watchName.value = '';
    void saveBook(
      { watches: [watch, ...watchBook.watches] },
      `Veille « ${watch.label} » créée, relancée toutes les ${Math.round(watch.intervalMs / 60_000)} min.`,
    );
  });

  void loadWatchBook()
    .then((book) => {
      watchBook = book;
      paintWatch();
    })
    .catch(() => paintWatch());

  // --- Journal d'opportunités (100 % local) -------------------------------------------
  let opportunities: OpportunityRecord[] = [];
  const opportunityStatus = h('p', { class: 'kui-note kui-opportunities' });

  function paintOpportunities(): void {
    const summary = opportunitySummary(opportunities);
    const gap = summary.gapAvg === null
      ? '—'
      : `${summary.gapSum > 0 ? '+' : ''}${fmt(summary.gapSum)} % (moyenne ${summary.gapAvg > 0 ? '+' : ''}${fmt(summary.gapAvg)} %)`;
    opportunityStatus.textContent = `Opportunités vues : ${fmt(summary.seen)} · écart médian cumulé : ${gap} · ${fmt(summary.wishesCovered)} envies couvertes`;
  }

  /** Ouvre l'annonce : le journal retient l'opportunité, sans aucun appel réseau. */
  async function trackOpen(listing: MarketListing): Promise<void> {
    try {
      opportunities = await recordOpportunity(listing, {
        wanted: wishSet.has(listing.characterId),
      });
    } catch {
      return; // un journal en échec ne doit pas bloquer l'ouverture de l'annonce
    }
    paintOpportunities();
  }

  /** Meilleure annonce connue par carte : la liste est déjà triée par affaire. */
  function bestByCard(): Map<number, MarketListing> {
    const best = new Map<number, MarketListing>();
    for (const listing of state.result?.listings ?? []) {
      if (!best.has(listing.characterId)) best.set(listing.characterId, listing);
    }
    return best;
  }

  const exportButton = h(
    'button',
    { type: 'button', class: 'kui-secondary kui-wishes-export' },
    'Exporter les envies (CSV)',
  ) as HTMLButtonElement;
  exportButton.addEventListener('click', () => {
    const best = bestByCard();
    const rows = wishRefs.map((card) => {
      const found = best.get(card.id);
      return {
        name: card.name,
        rarity: card.rarity ?? null,
        median: card.median ?? null,
        best: found ? { id: found.id, price: found.price } : null,
      };
    });
    if (typeof URL.createObjectURL !== 'function') {
      context.setStatus('Export CSV indisponible dans ce contexte.');
      return;
    }
    const csv = `\uFEFF${wishesCsv(rows)}`;
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = h('a', {
      href: url,
      download: `kyara-envies-${new Date().toISOString().slice(0, 10)}.csv`,
    });
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
    context.setStatus(`${fmt(rows.length)} envie(s) exportée(s) en CSV.`);
  });

  // --- Ordres d'achat préparés : carte, prix, quantité, plafonds, double confirmation ----
  let buyPlan: BuyPlan = normalizeBuyPlan(null);
  let orders: BuyOrderEntry[] = [];
  let draft: BuyOrderDraft | null = null;
  const buyStatus = h('p', { class: 'kui-note kui-buy-status', role: 'status' });
  const buyRecap = h('pre', { class: 'kui-buy-recap kui-order-recap' });
  const copyRecap = h(
    'button',
    { type: 'button', class: 'kui-secondary kui-buy-copy' },
    'Copier le récapitulatif',
  ) as HTMLButtonElement;
  const maxListing = h('input', {
    type: 'number',
    min: '1',
    step: '10',
    class: 'kui-number-input',
    'aria-label': 'Plafond par ordre, en chakra',
  }) as HTMLInputElement;
  const maxDay = h('input', {
    type: 'number',
    min: '1',
    step: '100',
    class: 'kui-number-input',
    'aria-label': "Plafond d'achat du jour, en chakra",
  }) as HTMLInputElement;
  const orderCard = h('input', {
    type: 'search',
    class: 'kui-search-input',
    placeholder: 'Nom de carte ou #identifiant',
    'aria-label': 'Carte de l’ordre d’achat',
  }) as HTMLInputElement;
  const orderMatches = h('div', { class: 'kui-buy-candidates' });
  const orderPrice = h('input', {
    type: 'number',
    min: '1',
    step: '1',
    class: 'kui-number-input',
    'aria-label': 'Prix de l’ordre, en chakra',
  }) as HTMLInputElement;
  const orderQty = h('input', {
    type: 'number',
    min: '1',
    max: String(BUY_ORDER_QTY_MAX),
    step: '1',
    class: 'kui-number-input',
    'aria-label': 'Quantité de l’ordre',
  }) as HTMLInputElement;
  orderQty.value = '1';
  const orderSend = guardedButton('Envoyer l’ordre', 'Confirmer l’ordre', () => sendOrder());
  orderSend.classList.add('kui-order-send');

  copyRecap.addEventListener('click', () => {
    const text = buyRecap.textContent ?? '';
    if (!navigator.clipboard?.writeText) {
      context.setStatus('Copie indisponible : sélectionne le texte du récapitulatif.');
      return;
    }
    void navigator.clipboard.writeText(text).then(
      () => context.setStatus('Récapitulatif copié.'),
      () => context.setStatus('Copie refusée par le navigateur.'),
    );
  });

  function paintOrder(): void {
    maxListing.value = String(buyPlan.maxPerListing);
    maxDay.value = String(buyPlan.maxPerDay);
    if (draft) {
      orderPrice.value = String(draft.price);
      orderQty.value = String(draft.qty);
    }
    const check = draft ? checkOrder(draft, buyPlan, orders) : null;
    buyRecap.textContent = orderRecap(draft, buyPlan, orders);
    orderSend.disabled = !check?.ok;
    orderSend.title = check?.ok
      ? 'Deux clics envoient l’ordre à Kyara'
      : (check?.message ?? 'Choisis une carte, un prix et une quantité');
    const spent = ordersSpentToday(orders);
    const done = orders.filter((entry) => entry.at >= dayStart()).length;
    buyStatus.textContent =
      `${fmt(done)} ordre(s) aujourd’hui · ${fmt(spent)} ◆ engagés sur ${fmt(buyPlan.maxPerDay)} ◆` +
      (draft ? '' : ' · choisis une carte pour préparer un ordre.');
  }

  const saveBuyPlan = (patch: Partial<BuyPlan>): void => {
    buyPlan = normalizeBuyPlan({ ...buyPlan, ...patch });
    void context.saveSettings('Enregistrement des plafonds…', async () => {
      await buyPlanItem.setValue(buyPlan);
      paintOrder();
      paintCandidates();
      return 'Plafonds d’achat enregistrés.';
    });
  };
  maxListing.addEventListener('change', () => saveBuyPlan({ maxPerListing: Number(maxListing.value) }));
  maxDay.addEventListener('change', () => saveBuyPlan({ maxPerDay: Number(maxDay.value) }));

  /** Choisit la carte de l'ordre ; le prix déjà saisi et la quantité sont conservés. */
  function chooseCard(id: number, name: string | null, price = 0): void {
    draft = {
      characterId: id,
      name,
      price: price > 0 ? price : (draft?.price ?? 0),
      qty: draft?.qty ?? 1,
    };
    orderCard.value = name ?? String(id);
    paintOrder();
  }

  function paintMatches(): void {
    const text = orderCard.value.trim();
    const numeric = /^#?\d+$/.test(text) ? Number(text.replace('#', '')) : null;
    if (numeric !== null && Number.isSafeInteger(numeric) && numeric > 0) {
      const card = data.catalog.find((item) => Number(item.id) === numeric);
      const pick = h(
        'button',
        { type: 'button', class: 'kui-secondary' },
        card?.name ? `Choisir ${card.name}` : `Choisir #${numeric}`,
      ) as HTMLButtonElement;
      pick.addEventListener('click', () => chooseCard(numeric, card?.name ?? null));
      orderMatches.replaceChildren(
        h(
          'div',
          { class: 'kui-buy-row' },
          h(
            'div',
            { class: 'kui-row-main' },
            h('b', {}, card?.name ?? `Carte #${numeric}`),
            h('small', {}, card ? 'Catalogue' : 'Hors catalogue connu : le site reste juge'),
          ),
          pick,
        ),
      );
      return;
    }
    if (text.length < 2) {
      orderMatches.replaceChildren();
      return;
    }
    const query = text.toLowerCase();
    const found = data.catalog
      .filter((card) => String(card.name ?? '').toLowerCase().includes(query))
      .slice(0, 4);
    if (!found.length) {
      orderMatches.replaceChildren(h('p', { class: 'kui-note' }, 'Aucune carte ne correspond.'));
      return;
    }
    orderMatches.replaceChildren(
      ...found.map((card) => {
        const id = Number(card.id);
        const pick = h(
          'button',
          { type: 'button', class: 'kui-secondary' },
          `Choisir ${card.name ?? `#${id}`}`,
        ) as HTMLButtonElement;
        pick.addEventListener('click', () => chooseCard(id, card.name ?? null));
        return h(
          'div',
          { class: 'kui-buy-row' },
          h(
            'div',
            { class: 'kui-row-main' },
            h('b', {}, card.name ?? `Carte #${id}`),
            h('small', {}, [card.rarity, card.series].filter(Boolean).join(' · ') || 'Catalogue'),
          ),
          pick,
        );
      }),
    );
  }

  orderCard.addEventListener('input', () => {
    // Une saisie libre ne garde pas la carte précédente : l'ordre doit être choisi.
    draft = null;
    paintMatches();
    paintOrder();
  });
  orderPrice.addEventListener('input', () => {
    if (!draft) return;
    draft = { ...draft, price: Number(orderPrice.value) };
    paintOrder();
  });
  orderQty.addEventListener('input', () => {
    if (!draft) return;
    draft = { ...draft, qty: Number(orderQty.value) };
    paintOrder();
  });

  /** Envoi réel : seulement après deux vrais clics sur le bouton armé. */
  async function sendOrder(): Promise<void> {
    const current = draft;
    if (!current) {
      buyStatus.textContent = 'Choisis d’abord une carte.';
      return;
    }
    const name = current.name ?? `Carte #${current.characterId}`;
    await context.perform(`Envoi de l’ordre · ${name}…`, async () => {
      const result = await placeBuyOrder(context.api, current, {
        plan: buyPlan,
        entries: orders,
      });
      orders = result.entries;
      paintOrder();
      if (!result.ok) throw new Error(result.message);
      void appendActivity(`${name} : ${result.message}`, 'sale');
      return result.message;
    });
  }

  // --- File d'ordres : plusieurs brouillons, plafond partagé, envoi séquentiel --------------
  let batch: BuyOrderDraft[] = [];
  const batchList = h('div', { class: 'kui-buy-candidates kui-batch' });
  const batchStatus = h('p', { class: 'kui-note kui-batch-status', role: 'status' });
  const batchSend = guardedButton('Envoyer la file', 'Confirmer la file', () => sendBatch());
  batchSend.classList.add('kui-batch-send');
  const batchAdd = trustedButton('Ajouter à la file', () => {
    if (!draft) {
      batchStatus.textContent = 'Prépare d’abord un ordre.';
      return;
    }
    batch.push({ ...draft });
    paintBatch();
    batchStatus.textContent = `${fmt(batch.length)} ordre(s) dans la file · ${fmt(batchTotal())} ◆ à engager.`;
  });
  batchAdd.classList.add('kui-batch-add');
  batchAdd.title = 'Ajouter l’ordre préparé à la file (aucun envoi)';

  function batchTotal(): number {
    return batch.reduce((sum, item) => sum + item.price * item.qty, 0);
  }

  function paintBatch(): void {
    batchSend.disabled = batch.length === 0;
    batchSend.title =
      batch.length === 0
        ? 'Ajoute au moins un ordre à la file'
        : 'Deux clics envoient la file, un ordre après l’autre (600 ms)';
    if (!batch.length) {
      batchList.replaceChildren(h('p', { class: 'kui-note' }, 'File vide : prépare un ordre puis ajoute-le.'));
      return;
    }
    batchList.replaceChildren(
      ...batch.map((item, index) => {
        const name = item.name ?? `Carte #${item.characterId}`;
        const remove = h(
          'button',
          { type: 'button', class: 'kui-secondary' },
          'Retirer',
        ) as HTMLButtonElement;
        remove.addEventListener('click', () => {
          batch = batch.filter((_, position) => position !== index);
          paintBatch();
        });
        return h(
          'div',
          { class: 'kui-buy-row' },
          h(
            'div',
            { class: 'kui-row-main' },
            h('b', {}, name),
            h('small', {}, `×${fmt(item.qty)} à ${fmt(item.price)} ◆ = ${fmt(item.price * item.qty)} ◆`),
          ),
          h('div', { class: 'kui-buy-actions' }, remove),
        );
      }),
    );
  }

  /** Envoi groupé : deux vrais clics, plafond partagé, arrêt au premier refus. */
  async function sendBatch(): Promise<void> {
    if (!batch.length) return;
    const file = batch.map((item) => ({ ...item }));
    await context.perform(`Envoi de ${fmt(file.length)} ordre(s)…`, async () => {
      const result = await placeBuyOrders(context.api, file, {
        plan: buyPlan,
        entries: orders,
      });
      orders = result.entries;
      batch = [];
      paintBatch();
      paintOrder();
      if (result.placed) {
        void appendActivity(
          `File d’ordres : ${fmt(result.placed)} envoyé(s) pour ${fmt(result.total)} ◆.`,
          'sale',
        );
      }
      if (result.stop) {
        throw new Error(
          `${fmt(result.placed)} ordre(s) envoyé(s) · ${result.stop}`,
        );
      }
      return `${fmt(result.placed)} ordre(s) envoyé(s) pour ${fmt(result.total)} ◆.`;
    });
  }

  // --- Envoi automatique de la file : coupé par défaut, plafond horaire --------------------
  let autoSettings = normalizeBuyAutoSettings(null);
  let autoSent: number[] = [];
  let autoLast = 0;
  let autoTimer: ReturnType<typeof setInterval> | null = null;
  let autoArmed = false;
  let autoDisposed = false;
  // Quitter la vue emporte le minuteur : aucun envoi avec l'état d'un rendu périmé.
  context.onCleanup(() => {
    autoDisposed = true;
    if (autoTimer) clearInterval(autoTimer);
    autoTimer = null;
  });
  const autoStatus = h(
    'p',
    { class: 'kui-note kui-auto-status', role: 'status' },
    'Envoi auto coupé.',
  );
  const autoToggle = h('button', { type: 'button', class: 'kui-secondary kui-auto-toggle' });
  autoToggle.textContent = 'Activer l’envoi auto';
  autoToggle.title = 'Deux clics : la file partirait sans autre geste, dans les plafonds';
  const autoEvery = h('input', {
    type: 'number',
    class: 'kui-number-input',
    min: '5',
    max: '720',
  }) as HTMLInputElement;
  const autoMax = h('input', {
    type: 'number',
    class: 'kui-number-input',
    min: '1',
    max: '20',
  }) as HTMLInputElement;

  function saveAuto(patch: Partial<typeof autoSettings>): void {
    autoSettings = normalizeBuyAutoSettings({ ...autoSettings, ...patch });
    autoEvery.value = String(autoSettings.intervalMin);
    autoMax.value = String(autoSettings.maxPerHour);
    void buyAutoSettingsItem.setValue(autoSettings).catch(() => undefined);
    paintAuto();
    armAuto();
  }

  autoEvery.addEventListener('change', () => saveAuto({ intervalMin: Number(autoEvery.value) }));
  autoMax.addEventListener('change', () => saveAuto({ maxPerHour: Number(autoMax.value) }));

  autoToggle.addEventListener('click', () => {
    if (!autoSettings.enabled && !autoArmed) {
      autoArmed = true;
      autoToggle.textContent = 'Confirmer l’envoi auto';
      autoStatus.textContent =
        'Second clic : la file partira seule, sans autre geste, dans les plafonds réglés.';
      return;
    }
    autoArmed = false;
    saveAuto({ enabled: !autoSettings.enabled });
  });

  function paintAuto(decision?: BuyAutoDecision): void {
    autoEvery.value = String(autoSettings.intervalMin);
    autoMax.value = String(autoSettings.maxPerHour);
    autoToggle.textContent = autoSettings.enabled ? 'Couper l’envoi auto' : 'Activer l’envoi auto';
    autoToggle.classList.toggle('kui-danger', autoSettings.enabled);
    if (!autoSettings.enabled) {
      autoStatus.textContent = 'Envoi auto coupé : la file ne part qu’avec deux vrais clics.';
      return;
    }
    if (decision?.action === 'hourly') {
      autoStatus.textContent = `Plafond horaire atteint (${fmt(autoSettings.maxPerHour)}/h) : pause jusqu’à ${new Date(decision.nextAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}.`;
      return;
    }
    if (decision?.action === 'empty') {
      autoStatus.textContent = 'Envoi auto actif : la file est vide, rien à envoyer.';
      return;
    }
    if (decision?.action === 'wait') {
      autoStatus.textContent = `Envoi auto actif : prochain envoi vers ${new Date(decision.nextAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}.`;
      return;
    }
    autoStatus.textContent = `Envoi auto actif : au plus ${fmt(autoSettings.maxPerHour)} ordre(s)/h, un lot toutes les ${fmt(autoSettings.intervalMin)} min.`;
  }

  function armAuto(): void {
    if (autoTimer) clearInterval(autoTimer);
    autoTimer = null;
    if (autoDisposed || !autoSettings.enabled) return;
    autoTimer = setInterval(() => void tickAuto(), 30_000);
    // Un premier contrôle différé laisse le temps à la file de se remplir.
    void tickAuto();
  }

  async function tickAuto(): Promise<void> {
    if (autoDisposed || document.visibilityState !== 'visible') return;
    const now = Date.now();
    const decision = autoBuyDecision({
      settings: autoSettings,
      sent: autoSent,
      queueLength: batch.length,
      lastAt: autoLast,
      now,
    });
    paintAuto(decision);
    if (decision.action !== 'send') return;
    await sendBatchAuto(decision.budget);
  }

  /** Envoi automatique : aucun second clic, mais plafond horaire et arrêt au premier refus. */
  async function sendBatchAuto(budget: number): Promise<void> {
    if (autoDisposed || !batch.length) return;
    const file = batch.slice(0, budget).map((item) => ({ ...item }));
    const now = Date.now();
    try {
      const result = await placeBuyOrders(context.api, file, { plan: buyPlan, entries: orders });
      orders = result.entries;
      batch = batch.slice(result.placed);
      autoLast = now;
      autoSent = pruneSent(
        [...autoSent, ...Array.from({ length: result.placed }, () => now)],
        now,
      );
      void buyAutoSentItem.setValue({ at: autoSent }).catch(() => undefined);
      paintBatch();
      paintOrder();
      paintAuto();
      if (result.placed) {
        void appendActivity(
          `Envoi auto : ${fmt(result.placed)} ordre(s) pour ${fmt(result.total)} ◆.`,
          'sale',
        );
      }
      if (result.stop) {
        autoStatus.textContent = `Envoi auto arrêté · ${result.stop}`;
        // Un refus n'est pas réessayé en boucle : on coupe jusqu'à décision humaine.
        saveAuto({ enabled: false });
      }
    } catch (error) {
      autoStatus.textContent = `Envoi auto interrompu · ${
        error instanceof Error ? error.message : 'erreur inconnue'
      }`;
    }
  }

  void Promise.all([buyAutoSettingsItem.getValue(), buyAutoSentItem.getValue()])
    .then(([rawSettings, rawSent]) => {
      autoSettings = normalizeBuyAutoSettings(rawSettings);
      autoSent = pruneSent(Array.isArray(rawSent?.at) ? rawSent.at : [], Date.now());
      paintAuto();
      armAuto();
    })
    .catch(() => undefined);

  paintAuto();

  paintBatch();

  const buyCandidates = h('div', { class: 'kui-buy-candidates' });
  let buyKey = '';

  /** Cinq meilleures annonces achetables de la dernière recherche, une par carte. */
  function buyables(): MarketListing[] {
    const best = new Map<number, MarketListing>();
    for (const listing of state.result?.listings ?? []) {
      if (listing.auction && !listing.buyout) continue;
      if (best.has(listing.characterId)) continue;
      best.set(listing.characterId, listing);
    }
    return [...best.values()].slice(0, 5);
  }

  function prepareButton(listing: MarketListing): HTMLButtonElement {
    const button = h(
      'button',
      { type: 'button', class: 'kui-secondary kui-market-prepare' },
      'Préparer',
    ) as HTMLButtonElement;
    button.title = 'Remplir l’ordre avec cette annonce (aucun envoi)';
    button.addEventListener('click', () => {
      chooseCard(listing.characterId, listing.name, listing.price);
      buyStatus.textContent = `Ordre préparé depuis l’annonce ${listing.id} · vérifie le prix, puis envoie.`;
    });
    return button;
  }

  function paintCandidates(): void {
    const list = buyables();
    const key = list.map((listing) => `${listing.id}:${listing.price}`).join('|');
    if (key === buyKey) return;
    buyKey = key;
    if (!list.length) {
      buyCandidates.replaceChildren(
        h('p', { class: 'kui-note' }, 'Aucune annonce achetable dans la dernière recherche.'),
      );
      return;
    }
    buyCandidates.replaceChildren(
      ...list.map((listing) => {
        const check = checkOrder(
          { characterId: listing.characterId, name: listing.name, price: listing.price, qty: 1 },
          buyPlan,
          orders,
        );
        return h(
          'div',
          { class: `kui-buy-row${check.ok ? '' : ' is-over'}` },
          h(
            'div',
            { class: 'kui-row-main' },
            h('b', {}, listing.name ?? `Carte #${listing.characterId}`),
            h(
              'small',
              {},
              `${fmt(listing.price)} ◆ · ${check.ok ? 'sous les plafonds' : 'hors plafond'} · annonce ${listing.id}`,
            ),
          ),
          h('div', { class: 'kui-buy-actions' }, prepareButton(listing)),
        );
      }),
    );
  }

  // --- Mes ordres d'achat ouverts : lecture de /api/me/market, annulation armée -------
  let myOrders: MyOrder[] = [];
  let myOrdersLoaded = false;
  let myOrdersError: string | null = null;
  const myOrdersStatus = h('p', { class: 'kui-note kui-my-orders-status', role: 'status' });
  const myOrdersList = h('div', { class: 'kui-buy-candidates kui-my-orders' });

  function paintMyOrders(): void {
    if (myOrdersError) {
      myOrdersList.replaceChildren(
        h('p', { class: 'kui-note' }, `Lecture impossible : ${myOrdersError}`),
      );
    } else if (!myOrdersLoaded) {
      myOrdersList.replaceChildren(h('p', { class: 'kui-note' }, 'Lecture de tes ordres…'));
    } else if (!myOrders.length) {
      myOrdersList.replaceChildren(
        h('p', { class: 'kui-note' }, 'Aucun ordre d’achat ouvert pour le moment.'),
      );
    } else {
      myOrdersList.replaceChildren(
        ...myOrders.map((order) => {
          // `/api/me/market` ne renvoie pas toujours la carte : le catalogue connu complète.
          const name =
            order.name ??
            data.catalog.find((card) => Number(card.id) === order.characterId)?.name ??
            `Carte #${order.characterId}`;
          const reste = remainingQty(order);
          const cancel = guardedButton('Annuler', 'Confirmer', () =>
            context.perform(`Annulation de l’ordre · ${name}…`, async () => {
              const result = await cancelBuyOrder(context.api, order.id);
              if (!result.ok) throw new Error(result.message);
              void appendActivity(
                `Ordre d’achat annulé : ${name} ×${fmt(order.qty)} à ${fmt(order.price)} ◆.`,
                'sale',
              );
              return `Ordre annulé : ${name}.`;
            }),
          );
          // Un ordre déjà rempli n'a plus rien à annuler.
          cancel.disabled = reste === 0;
          return h(
            'div',
            { class: 'kui-buy-row' },
            cardThumb(order.characterId),
            h(
              'div',
              { class: 'kui-row-main' },
              h('b', {}, name),
              h(
                'small',
                {},
                `×${fmt(order.qty)} à ${fmt(order.price)} ◆ · ` +
                  (order.filled ? `${fmt(order.filled)} rempli(s) · ` : '') +
                  `reste ${fmt(reste)} · ${order.status}`,
              ),
            ),
            h('div', { class: 'kui-buy-actions' }, cancel),
          );
        }),
      );
    }
    myOrdersStatus.textContent = myOrdersLoaded
      ? `${fmt(myOrders.length)} ordre(s) ouvert(s) · ${fmt(ordersValue(myOrders))} ◆ engagés`
      : 'Lecture de tes ordres…';
  }

  function loadMyOrders(): void {
    myOrdersLoaded = false;
    myOrdersError = null;
    paintMyOrders();
    void Promise.resolve(syncOrderAlerts(context.api))
      .then((result) => {
        myOrders = result?.orders ?? [];
      })
      .catch((error: unknown) => {
        myOrdersError = explainPanelError(error);
      })
      .finally(() => {
        myOrdersLoaded = true;
        paintMyOrders();
      });
  }

  loadMyOrders();

  void opportunitiesItem
    .getValue()
    .then((stored) => {
      opportunities = normalizeOpportunities(stored).seen;
    })
    .catch(() => undefined)
    .finally(() => paintOpportunities());

  void Promise.all([buyPlanItem.getValue(), buyOrdersItem.getValue()])
    .then(([storedPlan, storedOrders]) => {
      buyPlan = normalizeBuyPlan(storedPlan);
      orders = normalizeBuyOrders(storedOrders).entries;
    })
    .catch(() => undefined)
    .finally(() => paintOrder());

  paintOpportunities();
  paintOrder();

  // Le libellé porte le nombre de lignes ajoutables, mis à jour par `paint`.
  const addAllButton = guardedButton('★ Tout ajouter', 'Confirmer ?', () => addAll());
  addAllButton.classList.add('kui-market-add-all');
  addAllButton.setAttribute('aria-label', 'Ajouter toutes les envies affichées');
  addAllButton.title = 'Ajouter toutes les envies affichées à tes envies';

  function filters(): {
    noAuction: boolean;
    minDiscount: number;
    wishlist?: ReadonlySet<number>;
    order: 'deal' | 'ending';
  } {
    return {
      noAuction: state.market.noAuction,
      minDiscount: state.market.minDiscount,
      wishlist: state.market.wishOnly ? wishSet : undefined,
      order: state.market.sort === 'ending' ? ('ending' as const) : ('deal' as const),
    };
  }

  /** `append` relit la suite (pages ou envies) et fusionne avec l'affiché. */
  async function run(append = false): Promise<void> {
    if (state.busy) return;
    const previous = append ? state.result : null;
    // Une lecture neuve reprend la page mémorisée ; « Lire la suite » reprend après l'affiché.
    const startPage = previous ? previous.pages + 1 : state.startPage;
    if (!append) state.marketShown = MARKET_ROWS_SHOWN;
    state.busy = true;
    state.error = null;
    state.progress = null;
    state.aborted = false;
    const controller = new AbortController();
    searchAbort = controller;
    paint();
    try {
      const byWish = state.market.wishOnly;
      if (byWish && !wishRefs.length) {
        // Deux causes distinctes : wishlist vide, ou envies absentes du catalogue.
        throw new Error(
          data.wishIds.length
            ? 'Tes envies n’ont pas de nom au catalogue : décoche « ★ Mes envies » pour chercher tout le marché.'
            : 'Aucune envie à chercher : décoche « ★ Mes envies » pour chercher tout le marché.',
        );
      }
      const next = byWish
        ? await searchMarketCards(context.api, wishRefs, {
            ...filters(),
            text: state.market.text,
            series: state.market.series,
            rarity: state.market.rarity || undefined,
            sort: state.market.sort,
            buyNow: state.market.buyNow,
            missing: state.market.missing,
            startPage,
            signal: controller.signal,
            onCard: (read, total) => {
              state.progress = { read, total };
              paint();
            },
          })
        : await searchMarket(
            context.api,
            {
              text: state.market.text,
              series: state.market.series,
              rarity: state.market.rarity || undefined,
              sort: state.market.sort,
              buyNow: state.market.buyNow,
              missing: state.market.missing,
            },
            {
              ...filters(),
              startPage,
              signal: controller.signal,
              onPage: () => paint(),
            },
          );
      state.result = mergeSearchResults(previous, next, filters());
      state.aborted = next.aborted === true;
      // La prochaine ouverture reprend la suite exacte de cette lecture.
      void saveMarketPrefs({
        ...state.market,
        nextPage: Math.max(1, state.result.pages + 1),
        pages: state.result.pages,
      });
    } catch (error) {
      state.error = explainPanelError(error);
      state.result = null;
    } finally {
      if (searchAbort === controller) searchAbort = null;
      state.busy = false;
      paint();
    }
  }

  /** Bouton « Arrêter » : la lecture en cours s'interrompt entre deux pages. */
  function stopSearch(): void {
    searchAbort?.abort();
    context.setStatus('Arrêt demandé : la lecture se termine à la page en cours.');
  }

  /** État de la ligne, pour savoir si elle doit être reconstruite. */
  function rowState(listing: MarketListing): string {
    if (wishSet.has(listing.characterId)) return 'w';
    return blocked.has(listing.characterId) ? 'o' : 'a';
  }

  /** Annonces visibles : filtre optionnel des possédées, puis lignes demandées. */
  function visibleListings(): MarketListing[] {
    const result = state.result;
    if (!result) return [];
    const kept = state.market.hideOwned
      ? result.listings.filter((listing) => !blocked.has(listing.characterId))
      : result.listings;
    return kept.slice(0, state.marketShown);
  }

  function emptyMessage(): string {
    const result = state.result;
    if (!result) return '';
    const cards = result.cards;
    if (!result.listings.length) {
      if (cards) {
        if (!cards.total) return 'Aucune envie ne correspond au nom, à l’univers ou à la rareté saisis.';
        return result.complete
          ? 'Aucune annonce pour tes envies.'
          : `Aucune annonce pour ces ${fmt(cards.read)} envies — « Lire la suite » examine les suivantes.`;
      }
      return result.complete
        ? 'Aucune annonce ne correspond à ces critères.'
        : `Aucune annonce dans les ${fmt(result.pages)} premières pages lues — le marché en contient davantage, « Lire la suite » prolonge la lecture.`;
    }
    if (state.market.hideOwned) {
      return 'Toutes les annonces affichées sont déjà possédées : décoche « Masquer les possédées » pour les revoir.';
    }
    return '';
  }

  const rowNodes = new Map<string, { node: HTMLElement; state: string }>();
  let renderedKey = '';

  function buildRow(listing: MarketListing): HTMLElement {
    return marketRow(
      listing,
      wishSet,
      blocked.has(listing.characterId),
      rowActions(listing),
      (opened) => void trackOpen(opened),
    );
  }

  const paintedKey = (): string => {
    const visible = visibleListings();
    if (!state.result) return 'aucune';
    if (!visible.length) return `vide:${emptyMessage()}`;
    return visible.map((listing) => `${listing.id}:${rowState(listing)}`).join('|');
  };

  /** Reconstruit les lignes seulement quand la liste affichée change vraiment. */
  function paintRows(): void {
    const key = paintedKey();
    if (key === renderedKey) return;
    renderedKey = key;
    rowNodes.clear();
    const visible = visibleListings();
    if (!visible.length) {
      rows.replaceChildren(h('p', { class: 'kui-note' }, emptyMessage()));
      return;
    }
    rows.replaceChildren(
      ...visible.map((listing) => {
        const node = buildRow(listing);
        rowNodes.set(listing.id, { node, state: rowState(listing) });
        return node;
      }),
    );
  }

  /**
   * Une seule carte bouge après un ajout : sa ligne est remplacée, les 59 autres gardent
   * leur nœud. Un lot de 60 ajouts ne repeint donc plus 60 fois toutes les lignes.
   */
  function refreshCardRows(characterId: number): void {
    if (state.market.hideOwned) {
      renderedKey = '';
      paintRows();
      return;
    }
    for (const listing of visibleListings()) {
      if (listing.characterId !== characterId) continue;
      const entry = rowNodes.get(listing.id);
      if (!entry) continue;
      const node = buildRow(listing);
      entry.node.replaceWith(node);
      rowNodes.set(listing.id, { node, state: rowState(listing) });
    }
    renderedKey = paintedKey();
  }

  function paintCard(characterId: number): void {
    refreshCardRows(characterId);
    paintControls();
  }

  function paint(): void {
    paintControls();
    paintRows();
    paintCandidates();
  }

  /** Boutons, compteurs et statut : rien à voir avec les lignes elles-mêmes. */
  function paintControls(): void {
    const frozen = state.busy || adding;
    submit.disabled = frozen;
    submit.textContent = state.busy && !state.result ? 'Lecture…' : 'Chercher';
    // Une lecture envie par envie dure des dizaines de secondes : elle doit pouvoir s'arrêter.
    stop.hidden = !(state.busy && state.market.wishOnly);
    stop.disabled = !state.busy;
    more.disabled = frozen;
    more.hidden = !state.result || state.result.complete;
    moreRows.disabled = frozen;
    const result = state.result;
    const cards = result?.cards;
    const visible = visibleListings();
    const shown = visible.length;
    const tronque = result && result.listings.length > shown ? ` · ${fmt(shown)} affichées` : '';
    if (result && result.listings.length > shown) {
      moreRows.hidden = false;
      moreRows.textContent = `Afficher plus (${fmt(result.listings.length - shown)})`;
    } else {
      moreRows.hidden = true;
    }
    const pending = pendingAdds().length;
    if (!addAllButton.classList.contains('armed')) {
      addAllButton.textContent = pending
        ? `★ Tout ajouter (${fmt(pending)})`
        : '★ Tout ajouter';
      addAllButton.disabled = frozen || !pending;
    }
    // Compte honnête : ce que le silence cachait (possédées) et ce qui est déjà en envies.
    const ownedSeen = result
      ? result.listings.filter((listing) => blocked.has(listing.characterId)).length
      : 0;
    const wishSeen = result
      ? result.listings.filter((listing) => wishSet.has(listing.characterId)).length
      : 0;
    const compte = [
      ownedSeen ? `${fmt(ownedSeen)} possédée(s)` : '',
      wishSeen ? `${fmt(wishSeen)} déjà en envies` : '',
    ]
      .filter(Boolean)
      .join(' · ');
    const suffixe = compte ? ` · ${compte}` : '';
    if (state.error) status.textContent = state.error;
    else if (state.busy) {
      status.textContent = state.progress
        ? `Lecture des envies ${fmt(state.progress.read)}/${fmt(state.progress.total)}… · Arrêter pour interrompre`
        : 'Lecture du marché, page par page…';
    } else if (!result) {
      status.textContent = `${state.opening ? `${state.opening} ` : ''}Aucune recherche lancée.`;
    }
    else if (cards) {
      const echecs = cards.failures ? ` · ${fmt(cards.failures)} en échec` : '';
      const surplus = cards.saturated.length
        ? ` · plus de ${fmt(WISH_CARD_MAX_LISTINGS)} annonces : ${cards.saturated.slice(0, 3).join(', ')}${cards.saturated.length > 3 ? ` +${fmt(cards.saturated.length - 3)}` : ''}`
        : '';
      status.textContent = cards.total
        ? `${fmt(result.listings.length)} annonce(s)${tronque} · ${fmt(cards.read)}/${fmt(cards.total)} envie(s) lue(s)${echecs}${surplus}${suffixe}${result.complete ? '' : ' · lecture partielle'}${result.aborted ? ' · arrêtée' : ''}`
        : 'Aucune envie ne correspond au nom, à l’univers ou à la rareté saisis.';
    } else {
      const couverture = result.total ? ` sur ${fmt(result.total)}` : '';
      status.textContent = `${fmt(result.listings.length)} annonce(s)${tronque}${couverture} · ${fmt(result.pages)} page(s) lue(s)${suffixe}${result.complete ? '' : ' · lecture partielle'}${result.aborted ? ' · arrêtée' : ''}`;
    }
  }

  paint();

  return h(
    'div',
    {},
    h('h3', { class: 'kui-section-title' }, 'Chercher dans le marché'),
    h('div', { class: 'kui-market-filters' }, text, series, rarity, sort, discountField),
    h(
      'div',
      { class: 'kui-market-checks' },
      noAuction,
      wishOnly,
      missingOnly,
      buyNowOnly,
      hideOwnedBox,
      submit,
      stop,
      more,
      addAllButton,
    ),
    h('div', { class: 'kui-market-watch' }, watchName, watchCreate),
    watchList,
    watchStatus,
    opportunityStatus,
    h('div', { class: 'kui-wishes-export-row' }, exportButton),
    h(
      'div',
      { class: 'kui-buy-box' },
      h('h3', { class: 'kui-section-title' }, 'Préparer un ordre d’achat'),
      h(
        'p',
        { class: 'kui-note' },
        'Carte, prix et quantité sont vérifiés contre les plafonds avant tout envoi. ' +
          'Deux clics sur « Envoyer l’ordre » envoient l’ordre ; rien ne part sans ce geste.',
      ),
      h(
        'div',
        { class: 'kui-fields' },
        settingsField('Plafond par ordre (◆)', maxListing),
        settingsField('Plafond du jour (◆)', maxDay),
      ),
      settingsField('Carte (nom ou #identifiant)', orderCard),
      orderMatches,
      h(
        'div',
        { class: 'kui-fields' },
        settingsField('Prix (◆)', orderPrice),
        settingsField('Quantité', orderQty),
      ),
      buyRecap,
      h('div', { class: 'kui-buy-actions' }, orderSend, copyRecap),
      buyStatus,
      buyCandidates,
      h('h3', { class: 'kui-section-title' }, 'File d’ordres'),
      h(
        'p',
        { class: 'kui-note' },
        'Plusieurs ordres préparés, envoyés un par un avec 600 ms d’écart : le plafond du ' +
          'jour est partagé et la file s’arrête au premier refus.',
      ),
      batchList,
      h('div', { class: 'kui-buy-actions' }, batchAdd, batchSend),
      batchStatus,
      h('h3', { class: 'kui-section-title' }, 'Envoi automatique'),
      h(
        'p',
        { class: 'kui-note' },
        'Coupé par défaut. Une fois confirmé par deux clics, la file part sans autre geste, ' +
          'au plus une fois par intervalle et dans la limite horaire ; un refus du site coupe ' +
          'l’envoi auto.',
      ),
      h(
        'div',
        { class: 'kui-fields' },
        h(
          'label',
          { class: 'kui-field' },
          h('span', {}, 'Minutes entre deux envois'),
          autoEvery,
        ),
        h('label', { class: 'kui-field' }, h('span', {}, 'Ordres max par heure'), autoMax),
      ),
      h('div', { class: 'kui-buy-actions' }, autoToggle),
      autoStatus,
      h('h3', { class: 'kui-section-title' }, 'Mes ordres d’achat'),
      h(
        'p',
        { class: 'kui-note' },
        'Ordres encore ouverts sur Kyara : le reste à remplir et l’annulation (deux vrais clics).',
      ),
      myOrdersStatus,
      myOrdersList,
    ),
    state.market.wishOnly && unnamed > 0
      ? h(
          'p',
          { class: 'kui-note' },
          `${fmt(unnamed)} envie(s) sans nom connu — cherchées par nom, elles sont ignorées.`,
        )
      : null,
    status,
    rows,
    moreRows,
    h(
      'p',
      { class: 'kui-note' },
      'La recherche est en lecture seule et un clic ouvre l’annonce sur Kyara ; seuls les ordres préparés puis confirmés partent vers le site.',
    ),
  );
}

function renaissanceContent(data: PanelRenaissanceData): HTMLElement {
  const { state, estimate } = data;
  const totalMissing = state.cardRequirements.reduce((sum, row) => sum + row.missing, 0);
  const floor = floorCost(state.cardRequirements);
  const costValue = h('strong', {}, estimationLabel(estimate));
  const costTile = h(
    'div',
    { class: 'kui-metric' },
    h('span', { class: 'kui-metric-label' }, 'Coût estimé'),
    costValue,
  );
  const failureNote = h('p', { class: 'kui-note', hidden: true });
  const costNotes = new Map<string, HTMLElement>();

  const cardRows = state.cardRequirements.map((requirement) => {
    const note = h('small', {}, 'estimation…');
    if (requirement.rarity) costNotes.set(requirement.rarity, note);
    const fill = h('span', { class: 'kui-album-fill' }) as HTMLElement;
    const share =
      requirement.need && requirement.need > 0
        ? Math.min(100, Math.round(((requirement.have ?? 0) / requirement.need) * 100))
        : 100;
    fill.style.width = `${share}%`;
    return h(
      'div',
      { class: 'kui-data-row kui-rn-row' },
      h(
        'div',
        { class: 'kui-row-main' },
        h('b', {}, requirement.label),
        h('small', {}, `${fmt(requirement.have ?? 0)} / ${fmt(requirement.need ?? 0)}`),
        requirement.ok ? null : note,
      ),
      h('div', { class: 'kui-album-bar', 'aria-hidden': 'true' }, fill),
      h('span', { class: 'kui-chip' }, requirement.ok ? '✓ Fait' : `manque ${fmt(requirement.missing)}`),
    );
  });

  const otherRows = state.otherRequirements.map((requirement) => {
    const extra =
      requirement.key === 'boosters' && requirement.need !== null
        ? ` (${fmt(requirement.have ?? 0)} / ${fmt(requirement.need)})`
        : '';
    return h(
      'div',
      { class: `kui-condition${requirement.ok ? ' is-ok' : ' is-ko'}` },
      h('span', { class: 'kui-condition-mark' }, requirement.ok ? '✓' : '✕'),
      h(
        'div',
        { class: 'kui-row-main' },
        h('b', {}, requirement.label + extra),
        requirement.ok ? null : h('small', {}, requirement.hint),
      ),
    );
  });

  const root = h(
    'div',
    {},
    h(
      'div',
      { class: 'kui-metrics' },
      metric('Conditions', `${fmt(state.done)} / ${fmt(state.total)}`),
      metric('Cartes manquantes', fmt(totalMissing)),
      costTile,
    ),
    h(
      'p',
      { class: `kui-note${state.eligible ? ' kui-ok' : ''}` },
      state.eligible
        ? 'Toutes les conditions sont remplies : tu peux faire ta Renaissance.'
        : 'La Renaissance remet la collection à zéro mais garde les points de Renommée ; ' +
            'après la première, les boosters peuvent contenir des cartes Éveil.',
    ),
    state.waitUntil
      ? h(
          'p',
          { class: 'kui-note' },
          `Prochaine Renaissance possible à partir du ${new Date(state.waitUntil).toLocaleString('fr-FR')}.`,
        )
      : null,
    h('h3', { class: 'kui-section-title' }, 'Cartes à obtenir'),
    cardRows.length
      ? h('div', { class: 'kui-rows' }, ...cardRows)
      : h('p', { class: 'kui-note' }, 'Aucune condition de carte dans cette réponse.'),
    otherRows.length ? h('h3', { class: 'kui-section-title' }, 'Autres conditions') : null,
    otherRows.length ? h('div', { class: 'kui-conditions' }, ...otherRows) : null,
    failureNote,
    floor
      ? h(
          'p',
          { class: 'kui-note' },
          `Plancher : au moins ${fmt(floor)} ◆ si chaque carte manquante s’obtenait au prix minimum autorisé (15 ◆ dès Épique).`,
        )
      : null,
    h(
      'p',
      { class: 'kui-note' },
      'Estimation : annonces à prix fixe les moins chères de cartes différentes que tu n’as pas, ' +
        '50 à 100 par rareté. Quand le marché n’en montre pas assez, le reste est compté au prix ' +
        'de la plus chère trouvée (tuile marquée « partiel »). Aucune écriture, aucun ordre d’achat.',
    ),
  );

  let unsubscribe = (): void => {};
  /** Un rendu détaché avant son insertion dans le panneau doit rester rempli. */
  let mounted = false;
  const paint = (): void => {
    if (root.isConnected) mounted = true;
    else if (mounted) {
      unsubscribe();
      return;
    }
    costValue.textContent = estimationLabel(estimate);
    costTile.classList.toggle('is-partial', estimate.padded);
    for (const [rarity, node] of costNotes) {
      const row = estimate.byRarity.find((entry) => entry.rarity === rarity);
      node.textContent = row ? rarityCostLabel(row) : 'estimation…';
      node.hidden = false;
    }
    failureNote.hidden = estimate.failures === 0;
    failureNote.textContent = `${fmt(estimate.failures)} rareté(s) n’ont pas pu être estimées ; reviens sur l’onglet pour relancer.`;
  };
  unsubscribe = estimate.onChange(paint);
  void estimate.start();
  paint();
  return root;
}

function estimationLabel(estimate: LiveRenaissanceEstimate): string {
  if (!estimate.byRarity.length) return estimate.done ? '—' : 'estimation…';
  const suffix = estimate.done ? '' : ' · …';
  return `≈ ${fmt(estimate.total)} ◆${estimate.padded ? ' · partiel' : ''}${suffix}`;
}

function rarityCostLabel(row: RarityCost): string {
  if (row.cost === null) return 'coût indisponible';
  const share = row.listed < row.missing ? ` (${fmt(row.listed)}/${fmt(row.missing)} chiffrées)` : '';
  return `${row.padded ? '≈ ' : ''}${fmt(row.cost)} ◆ au plus bas${share}`;
}

function advisorBlock(context: ViewContext): HTMLElement {
  const open = h(
    'button',
    { type: 'button', class: 'kui-secondary' },
    'Analyser mes doublons',
  ) as HTMLButtonElement;
  open.addEventListener('click', () => {
    openCollectionPanel(context.api);
  });
  return h(
    'div',
    { class: 'kui-advisor-block' },
    h('h3', { class: 'kui-section-title' }, 'Conseils de vente'),
    h(
      'p',
      { class: 'kui-note' },
      'Ouvre un panneau dédié à gauche : analyse complète de la collection (médianes, ' +
        'concurrence, ordres d’achat), puis recyclage des seules cartes conseillées ' +
        '« Recycler », un exemplaire conservé. Rien n’est mis en vente automatiquement.',
    ),
    open,
  );
}

/**
 * Rend le conseil boosters déjà chargé : le sous-onglet Boosters déclenche la lecture,
 * puis ce bloc se contente d'afficher les lignes classées. Lecture seule, aucune
 * ouverture n'est déclenchée.
 */
function packsContent(data: PanelPacksData, context: ViewContext): HTMLElement {
  const summary =
    `${fmt(data.rows.length)} booster(s) chiffrés · ${fmt(data.poolsRead)} pool(s) lus` +
    (data.failed ? ` · ${fmt(data.failed)} en échec` : '') +
    '. Chances officielles par rareté, booster doré compris.';
  if (!data.rows.length) {
    return h(
      'div',
      { class: 'kui-packs-block' },
      h(
        'p',
        { class: 'kui-note', role: 'status' },
        `Aucun booster à compléter parmi ${fmt(data.packs)} booster(s) vendus.`,
      ),
    );
  }

  // Deux décimales : un arrondi à une décimale peut afficher 4,6 avant 4,7.
  const perOpening = (value: number): string =>
    value.toLocaleString('fr-FR', { maximumFractionDigits: 2 });
  // advisePacks trie déjà les gratuits par cartes nouvelles puis les payants par coût.
  const free = data.rows.filter((item) => item.pack.free);
  const paid = data.rows.filter((item) => !item.pack.free);
  const best = free[0] ?? null;
  const openButton = (item: (typeof data.rows)[number]): HTMLButtonElement => {
    const open = guardedButton('Ouvrir', 'Confirmer', () =>
      context.perform(`Ouverture de ${item.pack.name}…`, async () => {
        const result = await openPack(context.api, item.pack);
        if (!result.ok) throw new Error(result.message);
        void appendPackHistory({
          packId: item.pack.id,
          packName: item.pack.name,
          cards: result.cards,
        });
        void appendActivity(`${item.pack.name} ouvert : ${result.message}`, 'sale');
        return result.message;
      }),
    );
    open.classList.add('kui-pack-open');
    open.title = item.pack.free
      ? `Ouvre une fois ${item.pack.name} avec un booster gratuit, deux vrais clics`
      : `Ouvre une fois ${item.pack.name} (${fmt(item.pack.price)} ◆ au plus), deux vrais clics`;
    return open;
  };
  const row = (item: (typeof data.rows)[number], bestRow = false): HTMLElement =>
    h(
      'div',
      { class: `kui-data-row kui-pack-row${bestRow ? ' is-best' : ''}` },
      h(
        'div',
        { class: 'kui-row-main' },
        h(
          'b',
          {},
          item.pack.name,
          bestRow ? h('span', { class: 'kui-chip kui-pack-best' }, 'Le meilleur') : null,
        ),
        h(
          'small',
          {},
          `${item.pack.free ? 'gratuit' : `${fmt(item.pack.price)} ◆`} · ` +
            `${fmt(item.pool)} cartes · ${fmt(item.missing)} manquante(s)`,
        ),
        h(
          'small',
          {},
          `≈ ${perOpening(item.expectedNew)} nouvelle(s) par ouverture` +
            (item.pack.free || item.costPerNew === null
              ? ''
              : ` · ${fmt(Math.ceil(item.costPerNew))} ◆ / nouvelle`),
        ),
      ),
      h('div', { class: 'kui-buy-actions' }, openButton(item)),
    );

  return h(
    'div',
    { class: 'kui-packs-block' },
    h('p', { class: 'kui-note', role: 'status' }, summary),
    best
      ? h(
          'div',
          { class: 'kui-pack-reco' },
          h('span', { class: 'kui-eyebrow' }, 'Recommandation'),
          h('b', { class: 'kui-pack-reco-title' }, best.pack.name),
          h(
            'p',
            { class: 'kui-note' },
            `En moyenne ${perOpening(best.expectedNew)} carte(s) que tu n’as pas ` +
              `sur les ${fmt(best.pack.cards)} de chaque booster gratuit.`,
          ),
          h('div', { class: 'kui-buy-actions' }, openButton(best)),
        )
      : h('p', { class: 'kui-note' }, 'Aucun booster gratuit disponible en ce moment.'),
    ...(free.length
      ? [
          h(
            'h4',
            { class: 'kui-section-title' },
            'Boosters gratuits, du plus utile au moins utile',
          ),
          ...free.map((item, index) => row(item, index === 0)),
        ]
      : []),
    ...(paid.length
      ? [
          h(
            'details',
            { class: 'kui-pack-paid' },
            h('summary', {}, 'Et avec du chakra ?'),
            h(
              'p',
              { class: 'kui-note' },
              'Prix d’une carte nouvelle selon le booster acheté : plus c’est bas, mieux c’est.',
            ),
            ...paid.map((item) => row(item)),
          ),
        ]
      : []),
    h(
      'details',
      { class: 'kui-pack-paid' },
      h('summary', {}, 'Comment c’est calculé ?'),
      h(
        'p',
        { class: 'kui-note' },
        'Pour chaque booster : la liste exacte de ses cartes, les chances officielles par rareté et la part du pool que tu possèdes déjà. Le booster doré (une ouverture sur dix) est pris en compte. Tout se recalcule avec ta collection actuelle.',
      ),
    ),
  );
}

function albumsContent(data: PanelAlbumsData, context: ViewContext): HTMLElement {
  const filter = h('input', {
    type: 'search',
    class: 'kui-search-input',
    placeholder: 'Filtrer les albums…',
    'aria-label': 'Filtrer les albums par nom',
  }) as HTMLInputElement;
  const sort = h(
    'select',
    { class: 'kui-select', 'aria-label': 'Trier les albums' },
    h('option', { value: 'progress' }, 'Progression'),
    h('option', { value: 'missing' }, 'À compléter d’abord'),
  ) as HTMLSelectElement;
  const listHost = h('div', { class: 'kui-rows kui-albums' });
  const pager = h('div', {
    class: 'kui-pager',
    role: 'navigation',
    'aria-label': 'Pages des albums',
  });
  const pageNote = h('p', { class: 'kui-note' });
  const wished = new Set(data.wishIds);
  let mode: AlbumSort = 'progress';
  let open: string | null = null;
  let page = 1;
  const PER_PAGE = 20;
  sort.value = mode;

  const albumRow = (album: PanelAlbumsData['albums'][number]): HTMLElement => {
    const fill = h('span', { class: 'kui-album-fill' });
    fill.style.width = `${album.pct}%`;
    const small = !rewardAlbum(album);
    const row = h(
      'button',
      {
        type: 'button',
        class: `kui-data-row kui-album-row kui-album-open${small ? ' is-small' : ''}`,
        title: small
          ? 'Moins de 5 cartes : pas de récompense d’album'
          : 'Voir les cartes de cet album',
      },
      h(
        'div',
        { class: 'kui-row-main' },
        h('b', {}, album.series),
        h(
          'small',
          {},
          `${fmt(album.owned)}/${fmt(album.total)} · ${fmt(album.pct)} %` +
            (album.duplicates ? ` · ${fmt(album.duplicates)} doublon(s)` : ''),
        ),
      ),
      h('div', { class: 'kui-album-bar', 'aria-hidden': 'true' }, fill),
      h(
        'div',
        { class: 'kui-album-tags' },
        rewardAlbum(album) ? h('span', { class: 'kui-chip is-reward' }, '≥ 5 cartes') : null,
        h(
          'span',
          { class: 'kui-chip' },
          album.complete ? 'complet' : `manque ${fmt(album.missing)}`,
        ),
      ),
    ) as HTMLButtonElement;
    row.addEventListener('click', () => {
      open = album.series;
      paint();
    });
    return row;
  };

  const addMissing = (album: string, only?: AlbumCard): void => {
    const cards = albumCards(data.catalog, data.owned, album, wished).filter(
      (card) => !card.owned && !wished.has(card.id) && (!only || card.id === only.id),
    );
    if (!cards.length) return;
    const host = only ?? null;
    void context.saveSettings(`Ajout aux envies…`, async () => {
      let added = 0;
      for (const card of cards) {
        try {
          await gameActions.addWish(context.api, card.id);
          wished.add(card.id);
          added += 1;
        } catch {
          // Une carte refusée ne doit pas arrêter les autres.
        }
      }
      paint();
      return `${fmt(added)} carte(s) ajoutée(s) aux envies${host ? '' : ` · ${album}`}.`;
    });
  };

  const albumDetail = (series: string): HTMLElement => {
    const album = data.albums.find((item) => item.series === series);
    const cards = albumCards(data.catalog, data.owned, series, wished);
    const missing = cards.filter((card) => !card.owned);
    const back = h(
      'button',
      { type: 'button', class: 'kui-secondary' },
      '← Tous les albums',
    ) as HTMLButtonElement;
    back.addEventListener('click', () => {
      open = null;
      paint();
    });
    const bulk = guardedButton(
      `Ajouter ${fmt(missing.filter((card) => !wished.has(card.id)).length)} manquante(s) aux envies`,
      'Confirmer',
      () => addMissing(series),
    );
    bulk.disabled = !missing.some((card) => !wished.has(card.id));
    const rows = cards.map((card) => {
      const state = card.owned ? 'possédée' : card.wished ? 'dans tes envies' : 'manquante';
      const add = card.owned
        ? h('span', { class: 'kui-chip' }, '✓')
        : card.wished
          ? h('span', { class: 'kui-chip is-wish' }, '★')
          : guardedButton('Ajouter aux envies', 'Confirmer', () => addMissing(series, card));
      return h(
        'div',
        { class: `kui-data-row kui-album-card${card.owned ? ' is-owned' : ''}` },
        cardThumb(card.id),
        h(
          'div',
          { class: 'kui-row-main' },
          h('b', {}, card.name),
          h('small', {}, `${card.rarity || '?'} · ${state}`),
        ),
        add,
      );
    });
    return h(
      'div',
      { class: 'kui-album-detail' },
      back,
      h('h3', { class: 'kui-section-title' }, series),
      h(
        'p',
        { class: 'kui-note' },
        album
          ? `${fmt(album.owned)} / ${fmt(album.total)} cartes · ${fmt(album.pct)} %` +
              (album.complete ? ' · album complet' : ` · ${fmt(album.missing)} manquante(s)`) +
              (rewardAlbum(album) ? ' · récompense d’album (≥ 5 cartes)' : ' · moins de 5 cartes')
          : `${fmt(cards.length)} carte(s)`,
      ),
      h('div', { class: 'kui-quick-actions' }, bulk),
      h('h3', { class: 'kui-section-title' }, 'Cartes de l’album'),
      cards.length
        ? h('div', { class: 'kui-rows' }, ...rows)
        : h('p', { class: 'kui-note' }, 'Aucune carte connue dans cet album.'),
    );
  };

  const go = (target: number): void => {
    page = target;
    paint();
  };

  const paint = (): void => {
    if (open) {
      listHost.replaceChildren(albumDetail(open));
      pager.replaceChildren();
      pageNote.textContent = '';
      return;
    }
    const query = filter.value.trim().toLowerCase();
    const rows = sortAlbums(
      data.albums.filter((album) => !query || album.series.toLowerCase().includes(query)),
      mode,
    );
    if (!rows.length) {
      listHost.replaceChildren(h('p', { class: 'kui-note' }, 'Aucun album ne correspond.'));
      pager.replaceChildren();
      pageNote.textContent = '';
      return;
    }
    const pages = Math.max(1, Math.ceil(rows.length / PER_PAGE));
    page = Math.min(pages, Math.max(1, page));
    const start = (page - 1) * PER_PAGE;
    listHost.replaceChildren(...rows.slice(start, start + PER_PAGE).map(albumRow));
    const pageButton = (label: string, target: number, disabled: boolean, aria: string) => {
      const button = h(
        'button',
        { type: 'button', class: 'kui-page', 'aria-label': aria, title: aria, disabled },
        label,
      ) as HTMLButtonElement;
      button.addEventListener('click', () => go(target));
      return button;
    };
    const numbers: HTMLButtonElement[] = [];
    for (let index = Math.max(1, page - 2); index <= Math.min(pages, page + 2); index += 1) {
      const button = pageButton(
        String(index),
        index,
        false,
        index === page ? `Page ${index}, affichée` : `Page ${index}`,
      );
      if (index === page) {
        button.classList.add('is-current');
        button.setAttribute('aria-current', 'page');
      }
      numbers.push(button);
    }
    pager.replaceChildren(
      pageButton('«', 1, page === 1, 'Première page'),
      pageButton('‹', page - 1, page === 1, 'Page précédente'),
      ...numbers,
      pageButton('›', page + 1, page === pages, 'Page suivante'),
      pageButton('»', pages, page === pages, 'Dernière page'),
    );
    pageNote.textContent = `${fmt(start + 1)}–${fmt(start + PER_PAGE > rows.length ? rows.length : start + PER_PAGE)} sur ${fmt(rows.length)} album(s) · page ${fmt(page)} / ${fmt(pages)}`;
  };

  filter.addEventListener('input', () => {
    page = 1;
    paint();
  });
  sort.addEventListener('change', () => {
    mode = sort.value === 'missing' ? 'missing' : 'progress';
    page = 1;
    paint();
  });
  paint();

  const showcase = h('pre', { class: 'kui-showcase' }, data.showcase);
  const copy = trustedButton('Copier la vitrine', () => {
    const text = showcase.textContent ?? '';
    if (!navigator.clipboard?.writeText) {
      context.setStatus('Copie indisponible : sélectionne le texte de la vitrine.');
      return;
    }
    void navigator.clipboard.writeText(text).then(
      () => context.setStatus('Vitrine copiée.'),
      () => context.setStatus('Copie refusée par le navigateur.'),
    );
  });
  copy.classList.add('kui-secondary');

  return h(
    'div',
    { class: 'kui-albums-view' },
    metrics([
      ['Albums', fmt(data.totals.albums)],
      ['Complets', fmt(data.totals.complete)],
      ['Cartes', `${fmt(data.totals.owned)} / ${fmt(data.totals.cards)}`],
      ['Doublons', fmt(data.totals.duplicates)],
    ]),
    h('div', { class: 'kui-album-tools' }, h('label', { class: 'kui-search' }, filter), sort),
    h('h3', { class: 'kui-section-title' }, 'Progression par album'),
    h(
      'p',
      { class: 'kui-note' },
      'Les albums d’au moins 5 cartes passent devant, les plus petits finissent la liste et les complets ferment chaque groupe. Clique un album pour voir ses cartes et ajouter les manquantes à tes envies.',
    ),
    listHost,
    pager,
    pageNote,
    h('h3', { class: 'kui-section-title' }, 'Vitrine à partager'),
    h(
      'p',
      { class: 'kui-note' },
      'Texte calculé localement, sans requête : copie-le où tu veux.',
    ),
    showcase,
    copy,
  );
}

function statsAvatar(account: Account): HTMLElement {
  const src = imageUrl(account.avatar);
  return src
    ? h('img', { class: 'kui-avatar', src, alt: '', width: '24', height: '24' })
    : h(
        'span',
        { class: 'kui-avatar kui-avatar-fallback', 'aria-hidden': 'true' },
        account.pseudo.slice(0, 1).toUpperCase(),
      );
}

function statsPairs(account: Account): [string, string][] {
  const average = account.value !== null && account.owned ? account.value / account.owned : null;
  return [
    [
      'Origine',
      account.self
        ? 'compte connecté'
        : account.source === 'friend'
          ? 'liste d’amis'
          : 'ajout manuel',
    ],
    ['Rang global (site)', account.rankPos === null ? '—' : `#${fmt(account.rankPos)}`],
    [
      'Valeur des doublons',
      account.dupesValue === null ? 'non publié' : `${fmt(account.dupesValue)} ◆`,
    ],
    ['Valeur moyenne par carte', average === null ? '—' : `${fmt(Math.round(average))} ◆`],
    ['Séries presque finies', valueOrDash(account.seriesAlmost)],
    [
      'Cartes valorisées',
      account.value === null
        ? '—'
        : `${fmt(account.valuePriced)}${account.valueUnpriced ? ` · ${fmt(account.valueUnpriced)} sans prix` : ''}`,
    ],
    [
      'Valeur mesurée le',
      account.valueAt ? shortDate(new Date(account.valueAt).toISOString()) : '—',
    ],
  ];
}

function statsAccountRow(account: Account, stats: StatData, context: ViewContext): HTMLElement {
  const details = h('div', { class: 'kui-stats-detail', hidden: true });
  const rowButton = h(
    'button',
    {
      type: 'button',
      class: 'kui-stats-row',
      'aria-expanded': 'false',
      title: `Détail de ${account.pseudo}`,
    },
    h(
      'span',
      { class: 'kui-stats-account' },
      statsAvatar(account),
      h(
        'span',
        { class: 'kui-stats-name' },
        h('b', {}, account.pseudo),
        account.self ? h('small', {}, 'toi') : null,
      ),
    ),
    h('span', { class: 'kui-stats-number' }, valueOrDash(account.owned)),
    h(
      'span',
      { class: 'kui-stats-number' },
      account.value === null ? '—' : `${fmt(account.value)} ◆`,
    ),
    h('span', { class: 'kui-stats-number' }, valueOrDash(account.rankPos)),
  ) as HTMLButtonElement;
  rowButton.addEventListener('click', () => {
    const open = details.hidden;
    details.hidden = !open;
    rowButton.classList.toggle('is-open', open);
    rowButton.setAttribute('aria-expanded', String(open));
  });

  const reread = trustedButton('Relire ce compte', () =>
    context.perform(`Lecture de ${account.pseudo}…`, async () => {
      await syncStatsAccount(context.api, account.id);
      return `${account.pseudo} actualisé.`;
    }),
  );
  const remove = guardedButton('Retirer', 'Confirmer', () =>
    context.perform(`Retrait de ${account.pseudo}…`, async () => {
      await saveStats(removeAccount(stats, account.id));
      return `${account.pseudo} retiré du suivi.`;
    }),
  );
  if (account.self) {
    remove.disabled = true;
    remove.title = 'Le compte connecté ne peut pas être retiré.';
  }

  details.replaceChildren(
    h(
      'div',
      { class: 'kui-stats-pairs' },
      ...statsPairs(account).map(([label, value]) =>
        h('div', {}, h('span', {}, label), h('b', {}, value)),
      ),
    ),
    h('div', { class: 'kui-stats-actions' }, reread, remove),
  );
  if (account.error) details.append(h('p', { class: 'kui-data-error' }, account.error));
  if (account.valueUnpriced) {
    details.append(
      h(
        'p',
        { class: 'kui-note' },
        `${fmt(account.valueUnpriced)} carte(s) sans prix officiel : non comptées dans la valeur.`,
      ),
    );
  }
  return h('div', { class: 'kui-stats-item' }, rowButton, details);
}

/** Titres des groupes de cartes, dans l'ordre de `rarityRank` (inconnue en dernier). */
const PACK_RARITY_GROUPS = [
  'Mythiques',
  'Légendaires',
  'Épiques',
  'Rares',
  'Peu communes',
  'Communes',
  'Rareté inconnue',
] as const;

/** Visuelle de carte : l'id du site, sinon l'image donnée par le catalogue. */
function packCardImage(card: PanelPackHistoryCard): HTMLElement | null {
  const src =
    imageUrl(card.image) ?? (card.id ? imageUrl(`/cards/sm/${card.id}.webp`) : null);
  return src
    ? h('img', { class: 'kui-thumb', src, alt: '', width: '32', height: '48', loading: 'lazy' })
    : null;
}

function packCardRow(card: PanelPackHistoryCard): HTMLElement {
  const detail = [`${fmt(card.count)} fois`, card.packName]
    .filter(Boolean)
    .concat(shortDate(new Date(card.lastAt).toISOString()))
    .join(' · ');
  return h(
    'div',
    { class: 'kui-data-row' },
    packCardImage(card),
    h('div', { class: 'kui-row-main' }, h('b', {}, card.name), h('small', {}, detail)),
  );
}

/**
 * Boosters ouverts et cartes obtenues : journal récent des ouvertures, puis toutes les cartes
 * regroupées par rareté (mythique d'abord), de la plus récente à la plus ancienne dans chaque
 * groupe, avec leur visuelle.
 */
function packHistoryContent(data: PanelPackHistoryData): HTMLElement {
  const entries = [...data.entries].sort((a, b) => a.at - b.at);
  const last = entries.at(-1) ?? null;

  const journal = [...entries]
    .reverse()
    .slice(0, 20)
    .map((entry: PackHistoryEntry) =>
      h(
        'li',
        { class: 'kui-activity-entry is-sale' },
        h('small', {}, shortDate(new Date(entry.at).toISOString())),
        h(
          'span',
          {},
          `${entry.packName} · ${entry.cards.length} carte(s)` +
            (entry.cards.length
              ? ` : ${entry.cards.map((card: PackHistoryCard) => card.name).join(', ')}`
              : ''),
        ),
      ),
    );

  const groups = new Map<number, PanelPackHistoryCard[]>();
  for (const card of data.cards) {
    const rank = Math.min(rarityRank(card.rarity), PACK_RARITY_GROUPS.length - 1);
    const group = groups.get(rank);
    if (group) group.push(card);
    else groups.set(rank, [card]);
  }
  const sections = [...groups.entries()]
    .sort(([a], [b]) => a - b)
    .map(([rank, group]) => {
      const copies = group.reduce((count, card) => count + card.count, 0);
      return h(
        'section',
        { class: 'kui-pack-rarity' },
        h(
          'h3',
          { class: 'kui-section-title' },
          `${PACK_RARITY_GROUPS[rank] ?? 'Rareté inconnue'} · ` +
            `${fmt(group.length)} carte(s) · ${fmt(copies)} exemplaire(s)`,
        ),
        list(group.map(packCardRow)),
      );
    });

  return h(
    'div',
    {},
    metrics([
      ['Ouvertures', fmt(data.totals.opened)],
      ['Cartes obtenues', fmt(data.totals.cards)],
      [
        'Dernière ouverture',
        last ? shortDate(new Date(last.at).toISOString()) : '—',
      ],
    ]),
    h('h3', { class: 'kui-section-title' }, 'Journal récent des ouvertures'),
    journal.length
      ? h('ul', { class: 'kui-activity-log' }, ...journal)
      : h(
          'p',
          { class: 'kui-note' },
          'Aucun booster ouvert pour le moment : ouvre-en un dans Stats → Boosters ou active l’ouverture automatique.',
        ),
    h('h3', { class: 'kui-section-title' }, 'Cartes obtenues, par rareté'),
    sections.length
      ? h('div', { class: 'kui-pack-rarities' }, ...sections)
      : h('p', { class: 'kui-note' }, 'Les cartes tirées apparaîtront ici après la première ouverture.'),
  );
}

/**
 * Écritures de jeu : chaque envoi qui modifie quelque chose chez Kyara, avec son
 * résultat. Le journal est local, donc la vue ne relit rien sur le réseau ; elle
 * s'actualise quand une écriture arrive.
 */
function writeLogContent(data: PanelWriteLogData): HTMLElement {
  const summary = data.summary;
  const entries = [...data.entries].reverse().slice(0, 60);
  const rows = entries.map((entry: WriteLogEntry) =>
    h(
      'li',
      { class: `kui-activity-entry is-${entry.ok ? 'sale' : 'warn'}` },
      h('small', {}, shortDate(new Date(entry.at).toISOString())),
      h('span', {}, writeLogLine(entry)),
    ),
  );

  return h(
    'div',
    {},
    metrics([
      ['Écritures', fmt(summary.total)],
      ['Aujourd’hui', fmt(summary.today)],
      ['Refus', fmt(summary.failed)],
      [
        'Dernière',
        summary.lastAt ? shortDate(new Date(summary.lastAt).toISOString()) : '—',
      ],
    ]),
    h('h3', { class: 'kui-section-title' }, 'Dernières écritures'),
    rows.length
      ? h('ul', { class: 'kui-activity-log' }, ...rows)
      : h(
          'p',
          { class: 'kui-note' },
          'Aucune écriture de jeu enregistrée : une vente, un achat, un recyclage, un échange ou une envie apparaîtra ici, avec son résultat.',
        ),
  );
}

function activityContent(data: PanelActivityData, context: ViewContext): HTMLElement {
  const summary = data.summary;
  const peak = Math.max(1, ...summary.days.map((day) => day.count));
  const bars = h(
    'div',
    { class: 'kui-bars', 'aria-label': 'Ventes des quatorze derniers jours' },
    ...summary.days.map((day) =>
      h('span', {
        class: 'kui-bar',
        title: `${fmt(day.count)} vente(s) · ${fmt(day.total)} ◆`,
        style: `height:${Math.max(3, Math.round((day.count / peak) * 100))}%`,
      }),
    ),
  );
  const top = summary.top.map((sale) =>
    row(
      sale.name ?? `Carte #${sale.cardId}`,
      `${fmt(sale.price)} ◆ · ${shortDate(new Date(sale.at).toISOString())}`,
      'Vente',
      sale.cardId,
    ),
  );
  const journal = [...data.entries]
    .reverse()
    .slice(0, 20)
    .map((entry) =>
      h(
        'li',
        { class: `kui-activity-entry is-${entry.kind}` },
        h('small', {}, shortDate(new Date(entry.t).toISOString())),
        h('span', {}, entry.text),
      ),
    );

  return h(
    'div',
    {},
    metrics([
      ['Aujourd’hui', `${fmt(summary.today.count)} · ${fmt(summary.today.total)} ◆`],
      ['7 jours', `${fmt(summary.week.count)} · ${fmt(summary.week.total)} ◆`],
      ['30 jours', `${fmt(summary.month.count)} · ${fmt(summary.month.total)} ◆`],
      ['Meilleure vente', summary.top[0] ? `${fmt(summary.top[0].price)} ◆` : '—'],
    ]),
    h(
      'div',
      { class: 'kui-quick-actions' },
      trustedButton('Relire le marché', () =>
        context.perform('Lecture des ventes terminées…', async () => {
          await refreshActivityPanel(context.api);
          return 'Ventes terminées relues.';
        }),
      ),
    ),
    h('h3', { class: 'kui-section-title' }, 'Quatorze derniers jours'),
    bars,
    h('h3', { class: 'kui-section-title' }, 'Meilleures ventes du mois'),
    top.length
      ? list(top)
      : h('p', { class: 'kui-note' }, 'Aucune vente terminée enregistrée ce mois-ci.'),
    h('h3', { class: 'kui-section-title' }, 'Journal récent'),
    journal.length
      ? h('ul', { class: 'kui-activity-log' }, ...journal)
      : h('p', { class: 'kui-note' }, 'Le journal est vide pour le moment.'),
  );
}

function statsContent(
  data: PanelStatsData,
  context: ViewContext,
  state: StatsSearchState,
): HTMLElement {
  const stats = data.data;
  const accounts = Object.values(stats.accounts);
  const sorted = sortAccounts(accounts, stats.sort, stats.bestFirst);
  const column = columnOf(stats.sort);
  const valued = accounts.filter((account) => account.value !== null);

  const sync = trustedButton('Synchroniser tout', () =>
    context.perform('Synchronisation des statistiques…', async () => {
      await syncStatsPanel(context.api, context.setStatus);
      void appendActivity('Statistiques synchronisées.', 'info');
      return 'Statistiques synchronisées.';
    }),
  );
  const friends = trustedButton('Importer mes amis', () =>
    context.perform('Lecture de la liste d’amis…', async () => {
      const result = await importStatsFriends(context.api, context.setStatus);
      return `${fmt(result.imported)} ami(s) importé(s) · ${fmt(result.ignored)} ignoré(s)`;
    }),
  );

  const sort = h(
    'select',
    { class: 'kui-select', 'aria-label': 'Trier les comptes' },
    ...STAT_COLUMNS.map((entry) =>
      h('option', { value: entry.key, title: entry.title }, entry.label),
    ),
  ) as HTMLSelectElement;
  sort.value = stats.sort;
  const persistSort = (nextSort: ColumnKey, bestFirst: boolean): void => {
    void context.perform('Enregistrement du tri…', async () => {
      await saveStats({ ...stats, sort: nextSort, bestFirst });
      return 'Tri enregistré.';
    });
  };
  sort.addEventListener('change', () => persistSort(sort.value as ColumnKey, stats.bestFirst));
  const invert = trustedButton(stats.bestFirst ? 'Inverser l’ordre' : 'Meilleur en premier', () =>
    persistSort(stats.sort, !stats.bestFirst),
  );

  const searchInput = h('input', {
    type: 'search',
    class: 'kui-search-input',
    placeholder: 'Pseudo d’un joueur…',
    'aria-label': 'Rechercher un joueur à suivre',
  }) as HTMLInputElement;
  searchInput.value = state.query;
  const searchButton = h('button', { type: 'submit', class: 'kui-secondary' }, 'Chercher');
  const results = h('div', { class: 'kui-search-results' });
  const profileBox = h('div', { class: 'kui-profile-box' });
  const searchForm = h('form', { class: 'kui-search' }, searchInput, searchButton);
  let profileSeq = 0;

  const showProfile = async (hit: PlayerHit): Promise<void> => {
    const seq = ++profileSeq;
    profileBox.replaceChildren(h('p', { class: 'kui-data-loading' }, 'Lecture du profil…'));
    context.setStatus(`Profil de ${hit.pseudo}…`);
    try {
      const view = await loadStatsProfile(context.api, hit.id);
      if (seq !== profileSeq) return;
      const user = view.user ?? {};
      const title = String(user.pseudo ?? hit.pseudo);
      const value = view.value;
      const close = trustedButton('Fermer', () => {
        profileSeq += 1;
        profileBox.replaceChildren();
      });
      profileBox.replaceChildren(
        h(
          'div',
          { class: 'kui-profile' },
          h('div', { class: 'kui-profile-head' }, h('b', {}, title), close),
          metrics([
            ['Cartes différentes', value.uniques === null ? '—' : fmt(value.uniques)],
            ['Valeur', value.exact ? `${fmt(value.total)} ◆` : 'collection privée ou illisible'],
            ['Prix connus', value.exact ? fmt(value.priced) : '—'],
          ]),
          value.best.length
            ? h(
                'div',
                { class: 'kui-rows' },
                ...value.best.map((card) =>
                  row(
                    card.name,
                    `${card.rarity || '?'} · ${priceLabel(card.price)}`,
                    undefined,
                    Number(card.id),
                  ),
                ),
              )
            : h('p', { class: 'kui-note' }, 'Aucune carte publique à afficher.'),
          value.exact
            ? null
            : h(
                'p',
                { class: 'kui-note' },
                'La collection est privée : la valeur exacte n’est pas estimée.',
              ),
        ),
      );
      context.setStatus('');
    } catch (error) {
      if (seq !== profileSeq) return;
      profileBox.replaceChildren(h('p', { class: 'kui-data-error' }, explainPanelError(error)));
      context.setStatus('Profil inaccessible');
    }
  };

  const paintResults = (): void => {
    profileSeq += 1;
    profileBox.replaceChildren();
    if (!state.results) {
      results.replaceChildren(
        h(
          'p',
          { class: 'kui-note' },
          'Tape au moins deux caractères puis valide pour chercher un joueur.',
        ),
      );
      return;
    }
    if (!state.results.length) {
      results.replaceChildren(h('p', { class: 'kui-note' }, 'Aucun joueur trouvé.'));
      return;
    }
    results.replaceChildren(
      ...state.results.slice(0, 8).map((hit) => {
        const followed = Boolean(stats.accounts[hit.id]);
        const profile = trustedButton('Profil', () => void showProfile(hit));
        const add = trustedButton(followed ? 'Suivi' : 'Ajouter', () =>
          context.perform(`Ajout de ${hit.pseudo}…`, async () => {
            const result = addAccount(stats, hit, 'manual', Date.now());
            if (!result.added) {
              throw new Error(
                result.reason === 'full'
                  ? `Limite de ${STAT_MAX_ACCOUNTS} comptes atteinte.`
                  : 'Ce joueur est déjà suivi.',
              );
            }
            await saveStats(result.data);
            await syncStatsAccount(context.api, hit.id);
            return `${hit.pseudo} ajouté et mesuré.`;
          }),
        );
        if (followed) add.disabled = true;
        return actionRow(
          hit.pseudo,
          [
            hit.owned !== null ? `${fmt(hit.owned)} carte(s)` : 'collection inconnue',
            hit.pos !== null ? `rang #${fmt(hit.pos)}` : '',
          ]
            .filter(Boolean)
            .join(' · '),
          h('div', { class: 'kui-result-actions' }, profile, add),
        );
      }),
    );
  };

  const runSearch = async (): Promise<void> => {
    const query = state.query.trim();
    if (query.length < 2) {
      state.results = null;
      paintResults();
      return;
    }
    context.setStatus('Recherche…');
    try {
      let found = await searchPlayers(context.api, query).catch(() => [] as PlayerHit[]);
      if (!found.length)
        found = await searchLadder(context.api, query).catch(() => [] as PlayerHit[]);
      const needle = query.toLowerCase();
      const weight = (hit: PlayerHit) => {
        const name = hit.pseudo.toLowerCase();
        return name === needle ? 0 : name.startsWith(needle) ? 1 : name.includes(needle) ? 2 : 3;
      };
      state.results = found.sort(
        (a, b) => weight(a) - weight(b) || (b.owned ?? 0) - (a.owned ?? 0),
      );
      context.setStatus('');
    } catch (error) {
      state.results = null;
      context.setStatus(explainPanelError(error));
    }
    paintResults();
  };

  searchInput.addEventListener('input', () => {
    state.query = searchInput.value;
    if (state.query.trim().length < 2) {
      state.results = null;
      paintResults();
    }
  });
  searchForm.addEventListener('submit', (event) => {
    event.preventDefault();
    void runSearch();
  });
  paintResults();

  const board = sorted.length
    ? h(
        'div',
        { class: 'kui-stats-board' },
        h(
          'div',
          { class: 'kui-stats-head' },
          h('span', {}, 'Compte'),
          h('span', {}, 'Cartes'),
          h('span', {}, 'Valeur'),
          h('span', {}, 'Rang'),
        ),
        ...sorted.map((account) => statsAccountRow(account, stats, context)),
      )
    : h('p', { class: 'kui-note' }, 'Aucun compte suivi : cherche un joueur pour commencer.');

  return h(
    'div',
    {},
    metrics([
      ['Comptes', fmt(accounts.length)],
      [
        'Valeur cumulée',
        `◆ ${fmt(valued.reduce((sum, account) => sum + (account.value ?? 0), 0))}`,
      ],
      ['Cartes différentes', fmt(accounts.reduce((sum, account) => sum + (account.owned ?? 0), 0))],
      ['Comptes suivis', fmt(accounts.filter((account) => !account.self).length)],
    ]),
    h('div', { class: 'kui-quick-actions' }, sync, friends),
    h('h3', { class: 'kui-section-title' }, 'Suivre un joueur'),
    searchForm,
    results,
    profileBox,
    h('div', { class: 'kui-sort-bar' }, h('span', {}, `Tri : ${column.title}`), sort, invert),
    board,
    h(
      'p',
      { class: 'kui-note' },
      `${fmt(accounts.length)} compte(s) connu(s) · ` +
        `${stats.at ? `instantané de ${atLabel(stats.at)}` : 'jamais synchronisé'}.`,
    ),
  );
}

function newWishSearchState(): WishSearchState {
  return {
    query: '',
    market: {
      text: '',
      series: '',
      rarity: '',
      sort: 'newest',
      wishOnly: false,
      noAuction: true,
      missing: false,
      buyNow: false,
      hideOwned: false,
      minDiscount: 0,
    },
    result: null,
    error: null,
    busy: false,
    progress: null,
    marketShown: MARKET_ROWS_SHOWN,
    owned: new Set<number>(),
    startPage: 1,
    opening: '',
    aborted: false,
  };
}

/** Applique les préférences mémorisées à l'état de recherche du panneau. */
function applyMarketPrefs(state: WishSearchState, prefs: MarketSearchPrefs): void {
  state.market.text = prefs.text;
  state.market.series = prefs.series;
  state.market.rarity = prefs.rarity;
  state.market.sort = prefs.sort;
  state.market.noAuction = prefs.noAuction;
  state.market.missing = prefs.missing;
  state.market.buyNow = prefs.buyNow;
  state.market.minDiscount = prefs.minDiscount;
  state.market.hideOwned = prefs.hideOwned;
  state.market.wishOnly = prefs.wishOnly;
}

/**
 * « Chercher dans le marché », panneau secondaire à gauche : il remplace « Mes doublons »
 * s'il est ouvert, et reprend la recherche déjà utilisée par Envies (texte, série, rareté,
 * remise, mes envies, cartes possédées) au lieu de l'entasser dans la liste des envies.
 */
export function openMarketSearchPanel(api: PanelApi): void {
  closeOtherSecondaryPanels('market');
  document.getElementById('kyara-plus-market')?.remove();

  const host = h('div', { id: 'kyara-plus-market' });
  const root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = collectionCss;
  const status = h('p', { class: 'kc-status', role: 'status' }, 'Lecture de tes envies…');
  const body = h('div', { class: 'kc-market-body' });
  const closeButton = h(
    'button',
    { type: 'button', class: 'kc-close', 'aria-label': 'Fermer la recherche du marché' },
    '×',
  ) as HTMLButtonElement;

  const context: ViewContext = {
    api,
    perform: async (label, task) => {
      status.textContent = label;
      try {
        const message = await task();
        if (message) status.textContent = message;
      } catch (error) {
        status.textContent = explainPanelError(error);
      }
    },
    saveSettings: async (_label, task) => {
      try {
        await task();
      } catch (error) {
        status.textContent = explainPanelError(error);
      }
    },
    setStatus: (message) => {
      status.textContent = message;
    },
    onCleanup: () => {},
  };

  root.append(
    style,
    h(
      'aside',
      { class: 'kc-panel kc-market-panel', role: 'dialog', 'aria-label': 'Chercher dans le marché' },
      h(
        'header',
        { class: 'kc-head' },
        h(
          'div',
          {},
          h('b', {}, 'Chercher dans le marché'),
          h('small', {}, 'Filtres, remise, envies : tout au même endroit'),
        ),
        closeButton,
      ),
      status,
      body,
      h(
        'footer',
        { class: 'kc-foot' },
        'Ajouter ou acheter une annonce demande deux vrais clics. L’onglet Achat regroupe les achats groupés et les ordres.',
      ),
    ),
  );
  document.body.append(host);

  const state = newWishSearchState();
  state.market.wishOnly = true;
  void loadWishPanel(api)
    .then(async (data) => {
      const prefs = await loadMarketPrefs().catch(() => EMPTY_MARKET_PREFS);
      applyMarketPrefs(state, prefs);
      // Sans envie enregistrée, « ★ Mes envies » ne trouverait rien à chercher.
      if (!data.wishIds.length) state.market.wishOnly = false;
      state.startPage = resumePage(prefs);
      state.opening =
        `${fmt(data.wishIds.length)} envie(s) · ${fmt(data.catalogSize)} carte(s) au catalogue` +
        (state.startPage > 1 ? ` · reprise page ${fmt(state.startPage)}` : '') +
        '.';
      body.replaceChildren(marketSearchBox(data, context, state));
      status.textContent = state.opening;
    })
    .catch((error: unknown) => {
      status.textContent = `Lecture impossible : ${explainPanelError(error)}`;
    });

  const close = (): void => {
    document.removeEventListener('keydown', onKey);
    unregisterSecondaryPanel('market', close);
    host.remove();
  };
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') close();
  };
  closeButton.addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  registerSecondaryPanel('market', close);
}

interface PanelViewOptions {
  api: PanelApi;
}

/**
 * Regroupe plusieurs vues sous un même onglet, avec une barre de sous-onglets. Chaque
 * sous-vue garde son cache, ses abonnements et son bouton Actualiser ; seule celle qui
 * est affichée charge ses données.
 */
function groupView(options: {
  id: string;
  label: string;
  tabs: readonly PanelView[];
}): PanelView {
  const first = options.tabs[0];
  let active = first ? first.id : '';
  let mounted: PanelView | null = null;
  let destroyed = false;

  return {
    id: options.id,
    label: options.label,
    render: () => {
      destroyed = false;
      const host = h('div', { class: 'kui-subview' });
      const strip = h('div', {
        class: 'kui-subtabs',
        role: 'tablist',
        'aria-label': options.label,
      });
      const show = (id: string): void => {
        if (destroyed) return;
        active = id;
        mounted?.destroy?.();
        const view = options.tabs.find((item) => item.id === id) ?? first;
        if (!view) return;
        mounted = view;
        host.replaceChildren(view.render());
        for (const button of strip.querySelectorAll('button')) {
          const on = button.dataset.subview === active;
          button.classList.toggle('on', on);
          button.setAttribute('aria-selected', String(on));
          button.tabIndex = on ? 0 : -1;
        }
      };
      strip.replaceChildren(
        ...options.tabs.map((view) => {
          const button = h(
            'button',
            {
              type: 'button',
              class: 'kui-subtab',
              role: 'tab',
              'data-subview': view.id,
            },
            view.label,
          ) as HTMLButtonElement;
          button.addEventListener('click', () => show(view.id));
          return button;
        }),
      );
      show(active);
      return h('div', { class: 'kui-group' }, strip, host);
    },
    destroy: () => {
      destroyed = true;
      mounted?.destroy?.();
      mounted = null;
    },
  };
}

const AUTOMATION_STATE: Record<string, string> = {
  running: 'En cours',
  waiting: 'En attente',
  paused: 'En pause',
  stopped: 'Arrêtée',
};

/**
 * Réglages des automatisations, déplacés du popup de la barre d'outils : les contrôles
 * écrivent les mêmes stockages, donc le service de fond et la page Doublons les voient
 * aussitôt. Aucun réglage n'écrit sur Kyara.
 */
function settingsContent(data: PanelSettingsData, context: ViewContext): HTMLElement {
  const notice = h('p', { class: 'kui-note kui-settings-state', role: 'status' });
  const save = (label: string, task: () => Promise<void>): void => {
    void context
      .saveSettings(label, async () => {
        await task();
        return 'Réglages enregistrés.';
      })
      .then(() => {
        notice.textContent = '';
      });
  };

  const toggle = (
    key: 'autoOpen' | 'antiAfk' | 'autoSell' | 'orderQueueAuto' | 'autoOpenAllowChakra',
    label: string,
    hint: string,
  ): HTMLElement => {
    const input = h('input', { type: 'checkbox' }) as HTMLInputElement;
    input.checked = data.settings[key];
    input.addEventListener('change', () => {
      const value = input.checked;
      data.settings[key] = value;
      save('Enregistrement…', () => setSetting(key, value).then(() => undefined));
    });
    return h(
      'label',
      { class: 'kui-check' },
      input,
      h('span', {}, h('b', {}, label), h('small', {}, hint)),
    );
  };

  const packsHost = h('div', { class: 'kui-fields' });
  if (!data.packs.length) {
    packsHost.append(
      h(
        'p',
        { class: 'kui-note' },
        'Aucun booster en cache : ouvre la page des boosters puis clique sur Actualiser.',
      ),
    );
  } else {
    for (const pack of data.packs) {
      const input = h('input', { type: 'checkbox' }) as HTMLInputElement;
      input.checked = data.settings.autoOpenPackIds.includes(pack.id);
      input.addEventListener('change', () => {
        const ids = new Set(data.settings.autoOpenPackIds);
        if (input.checked) ids.add(pack.id);
        else ids.delete(pack.id);
        data.settings.autoOpenPackIds = [...ids];
        save('Enregistrement des boosters…', () =>
          setSetting('autoOpenPackIds', [...ids]).then(() => undefined),
        );
      });
      packsHost.append(h('label', { class: 'kui-check' }, input, h('span', {}, pack.name)));
    }
  }

  let budget: BudgetSettings = { ...data.budget };
  const budgetLine = h('p', { class: 'kui-note' }, data.budgetLabelText);
  const saveBudget = (patch: Partial<BudgetSettings>): void => {
    budget = normalizeBudget({ ...budget, ...patch });
    save('Enregistrement du budget…', () =>
      budgetSettingsItem.setValue(budget).then(() => undefined),
    );
  };

  const stamp = (at: number | null | undefined): string => (at ? atLabel(at) : '—');

  // Coupe-circuit : un seul interrupteur arrête toutes les boucles, et un déclenchement
  // automatique ne se lève qu'avec un réarmement explicite.
  const breaker = h('input', { type: 'checkbox' }) as HTMLInputElement;
  breaker.checked = data.settings.killSwitch;
  const breakerState = h('p', { class: 'kui-note kui-circuit-state', role: 'status' });
  const rearm = h(
    'button',
    { type: 'button', class: 'kui-secondary' },
    'Réarmer les automatisations',
  );
  const paintBreaker = (): void => {
    const state = data.circuit ?? normalizeCircuit(null);
    if (!data.settings.killSwitch) {
      breakerState.textContent = 'Automatisations autorisées.';
    } else if (state.tripped) {
      breakerState.textContent =
        `Déclenché automatiquement ${stamp(state.at)} après ${fmt(state.failures)} échec(s) ` +
        `(${state.source ?? 'boucle'}) : ${state.reason || 'erreur inconnue'}. ` +
        'Réarme à la main pour repartir.';
    } else {
      breakerState.textContent =
        'Arrêt manuel : vente auto, Auto-Open, reprix, veille et file d’ordres sont coupés.';
    }
    rearm.style.display = state.tripped && data.settings.killSwitch ? '' : 'none';
  };
  const setBreaker = (stop: boolean): void => {
    data.settings.killSwitch = stop;
    breaker.checked = stop;
    void context
      .saveSettings(stop ? 'Arrêt des automatisations…' : 'Réarmement…', async () => {
        if (stop) await setSetting('killSwitch', true);
        else await resetCircuit();
        if (!stop) data.circuit = normalizeCircuit(null);
        return stop ? 'Coupe-circuit activé.' : 'Automatisations réarmées.';
      })
      .then(paintBreaker);
  };
  breaker.addEventListener('change', () => setBreaker(breaker.checked));
  rearm.addEventListener('click', () => setBreaker(false));
  paintBreaker();

  const logBox = (entries: readonly { t: number; m: string }[]): HTMLElement =>
    entries.length
      ? h(
          'ul',
          { class: 'kui-activity-log' },
          ...entries.map((entry) => h('li', {}, `${stamp(entry.t)} · ${entry.m}`)),
        )
      : h('p', { class: 'kui-note' }, 'Aucun passage enregistré.');

  const refresh = trustedButton('Actualiser', () => {
    context.setStatus('Relecture des réglages et des boosters…');
    void (async () => {
      try {
        // Même relecture que l'ancien popup : le catalogue vient de Kyara, puis
        // la vue relit les réglages locaux.
        const raw = await context.api.request<unknown>('/api/packs', { timeoutMs: 25_000 });
        await packCatalogItem.setValue(normalizeAutoOpenPacks(raw));
      } catch {
        // Sans réponse, le catalogue en cache reste affiché.
      }
      await context.reload?.();
    })();
  });

  return h(
    'div',
    {},
    h('h3', { class: 'kui-section-title' }, 'Coupe-circuit'),
    h(
      'div',
      { class: 'kui-fields' },
      h(
        'label',
        { class: 'kui-check' },
        breaker,
        h(
          'span',
          {},
          h('b', {}, 'Arrêter toutes les automatisations'),
          h(
            'small',
            {},
            'Vente auto, Auto-Open, reprix, veille de prix et file d’ordres. Se réarme à la main.',
          ),
        ),
      ),
      rearm,
    ),
    breakerState,
    h('h3', { class: 'kui-section-title' }, 'Automatisations'),
    h(
      'div',
      { class: 'kui-fields' },
      toggle(
        'autoOpen',
        'Ouverture automatique de boosters',
        'Pause si le site demande une vérification.',
      ),
      toggle('antiAfk', 'Anti-AFK', 'Répond à la boîte « Tu es toujours là ? ».'),
      toggle('autoSell', 'Vente automatique des doublons', 'Selon les réglages de l’onglet Vente.'),
      toggle(
        'orderQueueAuto',
        'Vider la file d’ordres d’achat',
        'Place les ordres en attente dès qu’une place se libère (limite d’ordres ouverts du site).',
      ),
      toggle(
        'autoOpenAllowChakra',
        'Dépenser du chakra pendant l’ouverture automatique',
        'Sinon, seuls les boosters offerts et les dons sont ouverts.',
      ),
    ),
    h('h3', { class: 'kui-section-title' }, 'Rythme et budget partagé'),
    h(
      'div',
      { class: 'kui-fields' },
      settingsField(
        'Attente sans booster (s)',
        settingsNumber(data.settings.autoOpenIdleSec, 5, 300, (value) =>
          save('Enregistrement…', () => setSetting('autoOpenIdleSec', value).then(() => undefined)),
        ),
      ),
      settingsField(
        'Requêtes automatiques / minute',
        settingsNumber(budget.perMinute, 5, 120, (value) => saveBudget({ perMinute: value })),
      ),
      settingsField(
        'Écart minimal (ms)',
        settingsNumber(budget.minGapMs, 200, 5_000, (value) => saveBudget({ minGapMs: value })),
      ),
    ),
    budgetLine,
    h('h3', { class: 'kui-section-title' }, 'Boosters à ouvrir'),
    packsHost,
    h('h3', { class: 'kui-section-title' }, 'Ouverture automatique'),
    h(
      'p',
      { class: 'kui-note' },
      data.autoOpen.status
        ? `${AUTOMATION_STATE[data.autoOpen.status.state] ?? 'Active'} · ${data.autoOpen.status.message}` +
          ` · ${fmt(data.autoOpen.status.opened)} ouvert(s), ${fmt(data.autoOpen.status.cards)} carte(s)` +
          ` · prochain ${stamp(data.autoOpen.status.nextAt)}`
        : 'Aucune activité.',
    ),
    logBox(data.autoOpen.log),
    h('h3', { class: 'kui-section-title' }, 'Vente automatique'),
    h(
      'p',
      { class: 'kui-note' },
      !data.settings.autoSell
        ? 'Désactivée : active-la ci-dessus.'
        : data.autoSell.status
          ? `${AUTOMATION_STATE[data.autoSell.status.state] ?? 'Active'} · ${data.autoSell.status.message}` +
            ` · ${fmt(data.autoSell.status.placed)} annonce(s) créée(s)` +
            ` · prochain ${stamp(data.autoSell.status.nextAt)}`
          : 'En attente du premier passage (onglet kyara.games ouvert).',
    ),
    logBox(data.autoSell.log),
    h(
      'p',
      { class: 'kui-note' },
      `Version ${data.version} · ${updateLabel(data.update)} · réglages locaux, partagés avec la page Doublons et le service de fond.`,
    ),
    h(
      'div',
      { class: 'kui-quick-actions' },
      ...data.links.map((link) =>
        h(
          'a',
          { class: 'kui-secondary', href: link.href, target: '_blank', rel: 'noreferrer' },
          link.label,
        ),
      ),
      refresh,
    ),
    notice,
  );
}

/** Les vues interactives, branchées sur les mêmes modules que les pages complètes. */
export function createPanelViews({ api }: PanelViewOptions): PanelView[] {
  const wishSearch = newWishSearchState();
  const statsSearch: StatsSearchState = { query: '', results: null };
  const saleSettings: SettingsBoxState = { open: false };
  const tradeSettings: SettingsBoxState = { open: false };
  const all: PanelView[] = [
    asyncView({
      id: 'sell',
      label: 'Vente',
      eyebrow: 'Données réelles',
      title: 'Ta vente en un coup d’œil',
      lead: 'Vends un doublon, remplis les emplacements libres et gère tes annonces actives depuis ici.',
      api,
      load: () => loadSalePanel(api),
      render: (data, context) => saleContent(data, context, saleSettings),
    }),
    asyncView({
      id: 'dashboard',
      label: 'Aujourd’hui',
      eyebrow: 'Données réelles',
      title: 'Ton tableau de bord du jour',
      lead: 'Ventes, ordres, annonces qui finissent et meilleures alertes de la veille, sans écrire au jeu.',
      api,
      load: () => loadDashboardPanel(api),
      render: dashboardContent,
    }),
    asyncView({
      id: 'listings',
      label: 'Annonces',
      eyebrow: 'Données réelles',
      title: 'Tes annonces et tes ventes',
      lead: 'Le reste de durée de chaque annonce, une relance au même prix et le bénéfice réalisé.',
      api,
      load: () => loadListingsPanel(api),
      render: myListingsContent,
    }),
    asyncView({
      id: 'trades',
      label: 'Échanges',
      eyebrow: 'Données réelles',
      title: 'Les échanges du moment',
      lead: 'Accepte un bon échange directement ici, avec la carte à donner indiquée.',
      api,
      load: () => loadTradePanel(api),
      render: (data, context) => tradesContent(data, context, tradeSettings),
      watch: tradeWatch,
    }),
    asyncView({
      id: 'wishes',
      label: 'Envies',
      eyebrow: 'Données réelles',
      title: 'Tes envies',
      lead: 'Cherche une carte du catalogue et ajoute-la à ta liste sans quitter Kyara.',
      api,
      load: () => loadWishPanel(api),
      render: (data, context) => wishesContent(data, context, wishSearch),
    }),
    asyncView({
      id: 'buy',
      label: 'Achat',
      eyebrow: 'Données réelles',
      title: 'Acheter au meilleur prix',
      lead: 'Achat groupé au prix fixe, enchères et ordres d’achat sur les cartes qui te manquent.',
      api,
      load: () => loadBuyPanel(api),
      render: (data, context) => buyContent(data, context),
    }),
    asyncView({
      id: 'albums',
      label: 'Albums',
      eyebrow: 'Données réelles',
      title: 'Tes albums, presque finis',
      lead: 'Progression par série, cartes manquantes et vitrine copiable à partager.',
      api,
      load: () => loadAlbumsPanel(api),
      render: albumsContent,
    }),
    asyncView({
      id: 'renaissance',
      label: 'Renaissance',
      eyebrow: 'Lecture seule',
      title: 'Ta prochaine Renaissance',
      lead: 'Conditions remplies, cartes manquantes par rareté et coût estimé au plus bas du marché.',
      api,
      load: () => loadRenaissancePanel(api),
      render: (data) => renaissanceContent(data),
    }),
    asyncView({
      id: 'packs',
      label: 'Boosters',
      eyebrow: 'Lecture seule',
      title: 'Tes boosters, chiffrés',
      lead: 'Cartes nouvelles attendues, booster doré et coût par carte nouvelle, sans rien ouvrir.',
      api,
      load: () => loadPacksPanel(api),
      render: packsContent,
    }),
    asyncView({
      id: 'packHistory',
      label: 'Boosters ouverts',
      eyebrow: 'Historique local',
      title: 'Tes boosters ouverts',
      lead: 'Journal des ouvertures et cartes obtenues, regroupées par rareté et de la plus récente à la plus ancienne dans chaque groupe.',
      api,
      load: () => loadPackHistoryPanel(api),
      render: packHistoryContent,
      watch: (_data, refresh) => {
        const stop = packHistoryItem.watch(() => void refresh());
        return () => stop();
      },
    }),
    asyncView({
      id: 'writes',
      label: 'Écritures',
      eyebrow: 'Journal local',
      title: 'Tes écritures de jeu',
      lead: 'Chaque envoi vers Kyara — vente, achat, mise, recyclage, échange, envie, booster — avec son résultat.',
      api,
      load: () => loadWriteLogPanel(),
      render: writeLogContent,
      watch: (_data, refresh) => {
        const stop = writeLogItem.watch(() => void refresh());
        return () => stop();
      },
    }),
    asyncView({
      id: 'activity',
      label: 'Activité',
      eyebrow: 'Ventes et journal',
      title: 'Ton activité',
      lead: 'Retrouve les ventes terminées, les meilleures ventes et le journal partagé.',
      api,
      load: () => loadActivityPanel(),
      render: activityContent,
      watch: (_data, refresh) => {
        // Une vente terminée ou une entrée du journal met la vue à jour immédiatement.
        const stopActivity = activityItem.watch(() => void refresh());
        const stopSales = salesItem.watch(() => void refresh());
        return () => {
          stopActivity();
          stopSales();
        };
      },
    }),
    asyncView({
      id: 'stats',
      label: 'Stats',
      eyebrow: 'Dernière synchronisation',
      title: 'Ta progression',
      lead: 'Suis des joueurs, trie le tableau et actualise leur valeur avec les prix officiels.',
      api,
      load: () => loadStatsPanel(),
      render: (data, context) => statsContent(data, context, statsSearch),
    }),
    asyncView({
      id: 'settings',
      label: 'Réglages',
      eyebrow: 'Extension',
      title: 'Automatisations et options',
      lead: 'Ouverture des boosters, anti-AFK, vente automatique et budget partagé, réglés ici sans quitter Kyara.',
      api,
      load: () => loadSettingsPanel(),
      render: settingsContent,
    }),
  ];

  const find = (id: string): PanelView => {
    const view = all.find((item) => item.id === id);
    if (!view) throw new Error(`Vue absente : ${id}`);
    return view;
  };
  const renamed = (id: string, label: string): PanelView => ({ ...find(id), label });

  return [
    find('sell'),
    find('trades'),
    find('albums'),
    find('wishes'),
    find('buy'),
    groupView({
      id: 'activity',
      label: 'Activité',
      tabs: [
        renamed('activity', 'Ventes et journal'),
        renamed('dashboard', 'Aujourd’hui'),
        renamed('packHistory', 'Boosters ouverts'),
        renamed('writes', 'Écritures'),
      ],
    }),
    groupView({
      id: 'stats',
      label: 'Stats',
      tabs: [
        renamed('stats', 'Progression'),
        renamed('listings', 'Annonces'),
        renamed('renaissance', 'Renaissances'),
        renamed('packs', 'Boosters'),
      ],
    }),
    find('settings'),
  ];
}
