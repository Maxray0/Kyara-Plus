import type { ApiClient } from '../api';
import { getCatalog } from '../catalog';
import { getTradeSettings, type TradeSettings } from '../doublons/trade-settings';
import { loadTradeBoard, type TradeBoard } from '../doublons/trades';
import type { CatalogCard } from '../stats/model';
import { storage } from 'wxt/utils/storage';
import type { CardsExtra } from './cards';
import { isOffersPage } from './prices';

/** Filtre « bons échanges » de la page des offres, conservé entre deux visites. */
export const offersGoodOnlyItem = storage.defineItem<boolean>('local:offersGoodOnly', {
  fallback: false,
  version: 1,
});

/** Actualisation automatique de la page des offres. */
export const offersAutoItem = storage.defineItem<boolean>('local:offersAuto', {
  fallback: true,
  version: 1,
});

const FILTERS_KEY_PREFIX = 'kyara-lite:offers-filters:v1';
const OFFER_PREFIX = 'offre-';

export interface OffersLocation {
  href: string;
  hash: string;
  pathname: string;
  search: string;
}

export interface OffersPageOptions {
  document: Document;
  location: OffersLocation;
  api: Pick<ApiClient, 'request'>;
  loadBoard?: () => Promise<TradeBoard>;
  loadSettings?: () => Promise<TradeSettings>;
  now?: () => number;
  reload?: () => void;
  setTimer?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
}

function element(doc: Document, tag: string, className = '', text = ''): HTMLElement {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

/** Identifiant d'offre porté par la ligne Svelte (`offre-<uuid>`). */
export function offerIdFromRow(row: Element): string | null {
  if (!row.id.startsWith(OFFER_PREFIX)) return null;
  const id = decodeURIComponent(row.id.slice(OFFER_PREFIX.length));
  return id || null;
}

/** Clé de session utilisée par le bouton Actualiser de Better Kyara. */
export function offersFiltersKey(location: Pick<OffersLocation, 'pathname' | 'search'>): string {
  return `${FILTERS_KEY_PREFIX}:${location.pathname}${location.search}`;
}

/**
 * Outils de la page `/marche?onglet=offres` :
 * - filtre local sur les bons échanges calculés avec les réglages du comptoir ;
 * - actualisation automatique par rechargement, en conservant recherche et filtres ;
 * - mise en évidence de l'offre ciblée par `#offre-<uuid>` ;
 * - avertissement quand l'offre demandée par l'URL n'existe plus.
 *
 * Aucun outil n'est injecté sur une autre page et aucun appel réseau n'est fait
 * tant que le filtre n'est pas activé.
 */
export function createOffersPage(options: OffersPageOptions): CardsExtra {
  const doc = options.document;
  const location = options.location;
  const view = doc.defaultView;
  const now = options.now ?? Date.now;
  const setTimer =
    options.setTimer ?? ((callback: () => void, delay: number) => setTimeout(callback, delay));
  const clearTimer =
    options.clearTimer ?? ((timer: ReturnType<typeof setTimeout>) => clearTimeout(timer));
  const reload = options.reload ?? (() => view?.location.reload());

  let toolbar: HTMLElement | null = null;
  let goodButton: HTMLButtonElement | null = null;
  let autoInput: HTMLInputElement | null = null;
  let autoStatus: HTMLElement | null = null;
  let status: HTMLElement | null = null;
  let board: TradeBoard | null = null;
  let goodOnly = false;
  let auto = false;
  let loading = false;
  let destroyed = false;
  let autoTimer: ReturnType<typeof setTimeout> | null = null;
  let autoRevision = 0;
  let warning: HTMLElement | null = null;
  let warningTimer: ReturnType<typeof setTimeout> | null = null;
  let warningTries = 0;
  let targetId: string | null = null;
  let onOffersPage = false;
  // Évite qu'une lecture de préférences tardive écrase un choix déjà fait par l'utilisateur.
  let changedByUser = false;

  function setStatus(text: string): void {
    if (status) status.textContent = text;
  }

  function setAutoStatus(text: string): void {
    if (autoStatus) autoStatus.textContent = text;
  }

  function syncToolbar(): void {
    if (goodButton) {
      goodButton.setAttribute('aria-pressed', String(goodOnly));
      goodButton.classList.toggle('on', goodOnly);
    }
    if (autoInput) autoInput.checked = auto;
  }

  /** Identifiant de l'offre demandée par l'URL, qu'elle vienne du site ou de l'ancre. */
  function requestedOfferId(): string | null {
    try {
      const url = new URL(location.href);
      const offer = url.searchParams.get('offre');
      if (offer) return offer;
      if (!url.hash.startsWith(`#${OFFER_PREFIX}`)) return null;
      return decodeURIComponent(url.hash.slice(OFFER_PREFIX.length + 1));
    } catch {
      return null;
    }
  }

  function hideOfferWarning(): void {
    if (warningTimer) clearTimer(warningTimer);
    warningTimer = null;
    warningTries = 0;
    if (warning) warning.hidden = true;
  }

  /** Relit la liste tant qu'elle n'a pas fini de se rendre, sans interroger indéfiniment. */
  function retryOfferWarning(): void {
    if (warningTimer || destroyed || warningTries >= 20) return;
    warningTries++;
    warningTimer = setTimer(() => {
      warningTimer = null;
      updateOfferWarning();
    }, 1_200);
  }

  function ensureOfferWarning(): HTMLElement | null {
    if (!warning) {
      warning = element(doc, 'p', 'kyara-plus-offer-warning');
      warning.setAttribute('role', 'status');
      warning.setAttribute('aria-live', 'polite');
      const title = element(doc, 'strong', '', 'Offre introuvable.');
      const link = element(doc, 'a', '', 'Voir toutes les offres') as HTMLAnchorElement;
      link.href = '/marche?onglet=offres';
      warning.append(
        title,
        doc.createTextNode(' Elle a peut-être été acceptée, annulée ou expirée. '),
        link,
      );
    }
    const filters = doc.querySelector('.board .filters');
    if (!filters) return null;
    if (
      warning.parentElement !== filters.parentElement ||
      warning.previousElementSibling !== filters
    ) {
      filters.after(warning);
    }
    return warning;
  }

  /**
   * Le site charge une offre supprimée comme une page normale, sans ligne cible.
   * On attend que la liste soit rendue pour éviter un faux avertissement au chargement.
   */
  function updateOfferWarning(): void {
    if (destroyed) return;
    if (!isOffersPage(location.href)) {
      hideOfferWarning();
      return;
    }
    const id = requestedOfferId();
    if (!id || doc.getElementById(`offre-${id}`)) {
      hideOfferWarning();
      return;
    }
    const offers = doc.querySelector('.board .offers');
    if (!offers) {
      retryOfferWarning();
      return;
    }
    const count = offers.querySelectorAll('.offer').length;
    const summary = doc.querySelector('.board .count')?.textContent ?? '';
    if (!count && !/0\s+offres|aucune offre/i.test(summary)) {
      retryOfferWarning();
      return;
    }
    // La liste est rendue : inutile de continuer à la relire.
    if (warningTimer) clearTimer(warningTimer);
    warningTimer = null;
    const node = ensureOfferWarning();
    if (node) node.hidden = false;
  }

  function createToolbar(): HTMLElement {
    const bar = element(doc, 'div', 'kyara-plus-offers-tools');
    goodButton = element(doc, 'button', 'kyara-plus-offers-good') as HTMLButtonElement;
    goodButton.type = 'button';
    goodButton.textContent = 'Bons échanges';
    goodButton.title =
      'Afficher uniquement les offres rentables avec les réglages d’échange actuels.';
    goodButton.setAttribute('aria-pressed', 'false');
    goodButton.addEventListener('click', () => {
      changedByUser = true;
      goodOnly = !goodOnly;
      syncToolbar();
      void offersGoodOnlyItem.setValue(goodOnly);
      if (goodOnly) void refreshBoard();
      else {
        board = null;
        applyFilter();
        setStatus('Filtre désactivé');
      }
    });

    const label = element(doc, 'label', 'kyara-plus-offers-auto');
    autoInput = element(doc, 'input') as HTMLInputElement;
    autoInput.type = 'checkbox';
    autoInput.addEventListener('change', () => {
      changedByUser = true;
      auto = autoInput?.checked === true;
      syncToolbar();
      void offersAutoItem.setValue(auto);
      scheduleAuto();
    });
    label.append(autoInput, doc.createTextNode(' Auto'));

    autoStatus = element(doc, 'span', 'kyara-plus-offers-auto-status');
    status = element(doc, 'span', 'kyara-plus-offers-status');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    bar.append(goodButton, label, autoStatus, status);
    return bar;
  }

  function ensureToolbar(): void {
    if (!isOffersPage(location.href)) return;
    const filters = doc.querySelector('.board .filters');
    if (!filters) return;
    const created = !toolbar;
    if (!toolbar) toolbar = createToolbar();
    if (toolbar.parentElement !== filters) {
      const pills = filters.querySelector('.pills');
      if (pills) pills.after(toolbar);
      else filters.append(toolbar);
    }
    syncToolbar();
    // Sur le site réel, la barre peut être créée après la lecture des préférences.
    if (created) scheduleAuto();
  }

  function goodIds(): Set<string> | null {
    return board ? new Set(board.deals.map((deal) => deal.offerId)) : null;
  }

  function applyFilter(): void {
    const allowed = goodOnly ? goodIds() : null;
    for (const row of doc.querySelectorAll<HTMLElement>('.offers .offer')) {
      const id = offerIdFromRow(row);
      const good = !!id && !!allowed?.has(id);
      const hidden = goodOnly && !!allowed && !good && id !== targetId;
      row.classList.toggle('kyara-plus-good-offer', good);
      row.classList.toggle('kyara-plus-hidden', hidden);
      // Le thème du site donne un `display` aux lignes : `hidden` seul ne suffit pas.
      row.hidden = hidden;
    }
  }

  async function refreshBoard(): Promise<void> {
    if (loading) return;
    loading = true;
    setStatus('Calcul des bons échanges…');
    try {
      const loaded = await (options.loadBoard
        ? options.loadBoard()
        : (async () => {
            const settings = await (options.loadSettings ?? getTradeSettings)();
            const catalog: CatalogCard[] = await getCatalog(options.api);
            return loadTradeBoard(options.api, settings, catalog, now());
          })());
      // Le filtre a pu être désactivé pendant la lecture : ne pas réécrire son statut.
      if (!goodOnly || destroyed) return;
      board = loaded;
      const visible = doc.querySelectorAll('.offers .offer').length;
      const pageIds = new Set(
        [...doc.querySelectorAll('.offers .offer')]
          .map(offerIdFromRow)
          .filter((id): id is string => !!id),
      );
      const onPage = loaded.deals.filter((deal) => pageIds.has(deal.offerId)).length;
      setStatus(
        onPage
          ? `${onPage} bon(s) échange(s) sur ${visible} affichée(s)`
          : loaded.deals.length
            ? `Aucun bon échange sur cette page (${loaded.deals.length} ailleurs)`
            : 'Aucun bon échange avec ces réglages',
      );
    } catch {
      if (goodOnly && !destroyed) {
        board = null;
        setStatus('Bons échanges indisponibles');
      }
    } finally {
      loading = false;
      if (!destroyed) applyFilter();
    }
  }

  function scheduleAuto(): void {
    const revision = ++autoRevision;
    if (autoTimer) clearTimer(autoTimer);
    autoTimer = null;
    if (!auto || destroyed || !isOffersPage(location.href)) {
      if (!auto) setAutoStatus('Auto désactivée');
      return;
    }
    if (doc.visibilityState !== 'visible') return;
    setAutoStatus('Chargement du réglage…');
    void (options.loadSettings ?? getTradeSettings)()
      .then((settings) => {
        if (!auto || destroyed || revision !== autoRevision || !isOffersPage(location.href)) return;
        const minutes = Math.max(0, Math.floor(settings.tradeRefreshMin));
        if (!minutes) {
          setAutoStatus('Auto : intervalle à 0');
          return;
        }
        setAutoStatus(`Auto : ${minutes} min`);
        autoTimer = setTimer(() => {
          if (!auto || destroyed || !isOffersPage(location.href)) return;
          saveFilters();
          reload();
        }, minutes * 60_000);
      })
      .catch(() => setAutoStatus('Auto : réglages indisponibles'));
  }

  function buttonKey(button: Element): string {
    const copy = button.cloneNode(true) as Element;
    copy.querySelectorAll('.n').forEach((node) => node.remove());
    return (copy.textContent ?? '').replace(/\s+/g, ' ').trim();
  }

  function saveFilters(): void {
    const filters = doc.querySelector('.board .filters');
    if (!filters || !view) return;
    const state = {
      search: filters.querySelector<HTMLInputElement>('input[type="search"]')?.value || '',
      buttons: Object.fromEntries(
        [...filters.querySelectorAll('button[aria-pressed]')]
          .filter((button) => button !== goodButton)
          .map((button) => [buttonKey(button), button.getAttribute('aria-pressed') === 'true']),
      ),
    };
    try {
      view.sessionStorage.setItem(offersFiltersKey(location), JSON.stringify(state));
    } catch {
      // Stockage de session indisponible : le rechargement se fera sans restauration.
    }
  }

  function highlightHash(): void {
    if (!location.hash.startsWith(`#${OFFER_PREFIX}`)) return;
    const id = decodeURIComponent(location.hash.slice(1));
    if (id === targetId) return;
    const target = doc.getElementById(id);
    if (!target) return;
    targetId = id;
    target.classList.add('kyara-plus-offer-target');
    target.scrollIntoView?.({ block: 'center' });
    setTimeout(() => target.classList.remove('kyara-plus-offer-target'), 5_000);
  }

  function scan(): void {
    if (destroyed) return;
    // Une navigation SPA peut quitter les offres sans détruire ce contrôleur :
    // on arrête alors la minuterie pour ne pas recharger une autre page.
    if (!isOffersPage(location.href)) {
      onOffersPage = false;
      autoRevision++;
      if (autoTimer) clearTimer(autoTimer);
      autoTimer = null;
      hideOfferWarning();
      return;
    }
    if (!onOffersPage) {
      onOffersPage = true;
      scheduleAuto();
    }
    ensureToolbar();
    highlightHash();
    applyFilter();
    updateOfferWarning();
  }

  const onVisibility = (): void => {
    if (doc.visibilityState === 'visible') scan();
    scheduleAuto();
  };
  doc.addEventListener('visibilitychange', onVisibility);

  void Promise.all([offersGoodOnlyItem.getValue(), offersAutoItem.getValue()]).then(
    ([storedGood, storedAuto]) => {
      if (destroyed) return;
      if (!changedByUser) {
        goodOnly = storedGood === true;
        auto = storedAuto === true;
        syncToolbar();
        if (goodOnly) void refreshBoard();
        scheduleAuto();
      }
      applyFilter();
    },
  );

  scan();

  return {
    scan,
    destroy(): void {
      destroyed = true;
      autoRevision++;
      doc.removeEventListener('visibilitychange', onVisibility);
      if (autoTimer) clearTimer(autoTimer);
      autoTimer = null;
      hideOfferWarning();
      warning?.remove();
      warning = null;
      toolbar?.remove();
      toolbar = null;
      for (const row of doc.querySelectorAll<HTMLElement>('.offers .offer')) {
        row.hidden = false;
        row.classList.remove(
          'kyara-plus-good-offer',
          'kyara-plus-hidden',
          'kyara-plus-offer-target',
        );
      }
    },
  };
}
