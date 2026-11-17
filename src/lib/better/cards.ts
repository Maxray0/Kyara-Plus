import { cardImageId, characterId, formatPrice, isOffersPage, type CardResult } from './prices';
import type { CachedPriceService } from './price-cache';

const RARITY_NAMES: Record<string, string> = {
  C: 'Commune',
  U: 'Peu commune',
  R: 'Rare',
  E: 'Épique',
  L: 'Légendaire',
  M: 'Mythique',
};

/** Éléments injectés par cette extension : ignorés par l'observateur de mutations. */
const OWNED_UI = [
  '.kyara-lite-meta',
  '.kyara-lite-card-controls',
  '.kyaraext-watch-button',
  '.kyaraext-watch-list',
  '.kyaraext-watch-feed',
  '.kyaraext-notification-tools',
  '.kyaraext-notification-buyout',
  '.kyaraext-wish-badge',
  '.kyaraext-wish-tile-badge',
  '.kyaraext-chat-legend',
  '.kyara-plus-offers-tools',
  '.kyara-plus-offer-warning',
].join(', ');

export interface CardsExtra {
  scan(): void;
  destroy?(): void;
}

export interface CardsOptions {
  document: Document;
  location: Location;
  service: Pick<CachedPriceService, 'peek' | 'get' | 'ready' | 'flush' | 'destroy'>;
  /** Modules branchés sur le même cycle d'analyse (veille, notifications, couleurs de chat…). */
  extras?: CardsExtra[];
}

interface Surface {
  row: HTMLElement;
  parent: HTMLElement;
  kind: string;
  details: boolean;
}

interface Entry extends Surface {
  id: number;
  meta?: HTMLElement;
  price?: HTMLElement;
  value?: HTMLElement;
  period?: HTMLElement;
  name?: HTMLElement;
  rarity?: HTMLElement;
  series?: HTMLElement;
  loading: boolean;
  loaded: boolean;
  deferred: boolean;
  expiresAt?: number;
}

function node(doc: Document, tag: string, className: string, content = ''): HTMLElement {
  const element = doc.createElement(tag);
  element.className = className;
  element.textContent = content;
  return element;
}

/** Libellé de la période d'une cotation. */
export function periodLabel(result: CardResult, kind: string): string {
  if (result.status === 'ok') {
    return result.basis === 'last10'
      ? `${kind === 'collection' ? '' : 'méd. '}${result.sampleSize} ventes`
      : `méd. ${result.period} j`;
  }
  return result.status === 'error' ? 'indisp.' : 'méd. inconnue';
}

export function priceTitle(result: CardResult): string {
  let title: string;
  if (result.basis === 'last10') {
    title =
      result.status === 'ok'
        ? `Médiane des ${result.sampleSize} dernières ventes terminées : ${formatPrice(result.value ?? 0)} chakra. Repère historique, pas un prix de vente garanti.`
        : 'Aucune vente récente disponible. Valeur inconnue.';
  } else if (result.status === 'ok') {
    title = `Médiane des ventes sur ${result.period} jours : ${formatPrice(result.value ?? 0)} chakra. Repère historique, pas un prix de vente garanti.`;
  } else if (result.status === 'error') {
    title = `Prix indisponible : ${result.message || 'erreur de lecture'}`;
  } else {
    title = 'Aucune médiane disponible sur 7 ou 30 jours.';
  }
  if (Number.isFinite(result.fetchedAt)) {
    title += ` Relevée le ${new Date(result.fetchedAt).toLocaleString('fr-FR')}. Cache de navigation : ${
      result.basis === 'last10' ? '1 h' : '24 h'
    } maximum.`;
  }
  return title;
}

/**
 * Affiche nom, série, rareté et prix médian sur les cartes des offres, échanges, fenêtres
 * d'échange et collection (Légendaires et Mythiques seulement). Lecture seule.
 */
export function createCardsController(options: CardsOptions) {
  const { document: doc, location, service } = options;
  const view = doc.defaultView as Window & typeof globalThis;
  const extras = options.extras ?? [];
  const entries = new Map<HTMLElement, Entry>();
  const visible = new Set<Entry>();
  let active = 0;
  let scanTimer: ReturnType<typeof setTimeout> | undefined;
  let startTimer: ReturnType<typeof setTimeout> | undefined;
  let nextStart = 0;
  let refreshButton: HTMLButtonElement | null = null;
  let destroyed = false;

  const idOf = (row: HTMLElement) =>
    characterId(row.getAttribute('href')) ??
    cardImageId(row.querySelector('img')?.getAttribute('src') ?? null);

  function surfaces(): Map<HTMLElement, Surface> {
    const cards = new Map<HTMLElement, Surface>();
    const add = (row: Element, parent: Element | null, kind: string, details = true) => {
      if (parent && row.querySelector('img')) {
        cards.set(row as HTMLElement, {
          row: row as HTMLElement,
          parent: parent as HTMLElement,
          kind,
          details,
        });
      }
    };
    const all = (root: ParentNode, selector: string) => root.querySelectorAll(selector);

    if (isOffersPage(location.href)) {
      for (const row of all(doc, '.offers .give a.big[href], .offers .want a.thumb[href]')) {
        add(row, row, row.matches('.give a.big') ? 'give' : 'want', !row.matches('.give a.big'));
      }
    }
    const url = new URL(location.href);
    if (/^\/marche\/?$/.test(url.pathname) && url.searchParams.get('onglet') === 'echanges') {
      for (const row of all(doc, '.trades > .trade .sides .thumbs > a.thumb'))
        add(row, row, 'market');
      for (const row of all(doc, '.trades > .trade .trays > .tray .slots > li'))
        add(row, row, 'unified');
    }
    for (const dialog of all(doc, '[role="dialog"]')) {
      for (const row of all(
        dialog,
        'form .cols .picker .res > li > button, form .cols .picker .chosen > li',
      )) {
        add(row, row.querySelector('.nm'), 'friend');
      }
      for (const row of all(dialog, '.builder .browse .grid > div'))
        add(row, row.querySelector('.cap'), 'gallery');
      for (const row of all(dialog, '.builder .offer .chips > .chip:not(.ch)')) {
        add(row, row.querySelector('.cn'), 'friend');
      }
      for (const row of all(dialog, '.od .grid > button')) add(row, row, 'creator');
      for (const row of all(
        dialog,
        'form.form .trays > .tray .slots > li, form.form .shelf .grid > li > button.tile, .od .trays > .tray .slots > li, .od .shelf .grid > li > button',
      )) {
        add(row, row, 'unified');
      }
    }
    if (/^\/collection\/?$/.test(url.pathname)) {
      for (const row of all(doc, '.wrap.body .grid .cell:has(.tcg.r-L, .tcg.r-M)')) {
        add(row, row.querySelector('.mk'), 'collection', false);
      }
    }
    return cards;
  }

  function paint(entry: Entry, result: CardResult): void {
    if (!entry.meta) return;
    entry.meta.dataset.state = result.status;
    if (entry.name) {
      entry.name.textContent =
        result.name ||
        entry.row.querySelector('img')?.alt ||
        entry.row.title ||
        `Carte #${entry.id}`;
      entry.name.title = entry.name.textContent;
    }
    if (entry.series) {
      entry.series.textContent =
        result.series || (result.status === 'error' ? 'Série indisponible' : 'Série inconnue');
      entry.series.title = entry.series.textContent;
    }
    if (entry.rarity) {
      entry.rarity.textContent = RARITY_NAMES[result.rarity ?? ''] || 'Rareté inconnue';
      entry.rarity.dataset.rarity = result.rarity || '';
    }
    if (entry.price && entry.value && entry.period) {
      entry.value.textContent =
        result.status === 'ok' ? `${formatPrice(result.value ?? 0)} ◆` : '— ◆';
      entry.period.textContent = periodLabel(result, entry.kind);
      entry.price.title = priceTitle(result);
      entry.price.setAttribute('aria-label', entry.price.title);
    }
    entry.expiresAt = result.expiresAt || Date.now() + 60_000;
    entry.loaded = true;
  }

  function pump(): void {
    clearTimeout(startTimer);
    if (destroyed || doc.visibilityState !== 'visible') return;
    for (const entry of entries.values()) {
      if (!visible.has(entry) && !entry.row.closest('[role="dialog"] .trays .slots')) continue;
      if (active >= 3) break;
      if (
        (entry.loaded && (entry.expiresAt ?? 0) > Date.now()) ||
        entry.loading ||
        !entry.row.isConnected ||
        idOf(entry.row) !== entry.id
      ) {
        continue;
      }
      const cached = service.peek(entry.id);
      if (cached) {
        paint(entry, cached);
        continue;
      }
      const delay = nextStart - Date.now();
      if (delay > 0) {
        startTimer = setTimeout(pump, delay);
        return;
      }
      active += 1;
      entry.loading = true;
      nextStart = Date.now() + 250;
      const current = () =>
        entries.get(entry.row) === entry &&
        !!entry.meta?.isConnected &&
        idOf(entry.row) === entry.id;
      void service
        .get(entry.id)
        .then((result) => {
          if (current()) paint(entry, result);
        })
        .catch(() => {
          if (entries.get(entry.row) === entry && entry.meta?.isConnected) {
            paint(entry, {
              status: 'error',
              value: null,
              period: null,
              message: 'Lecture impossible',
              fetchedAt: Date.now(),
              expiresAt: Date.now() + 60_000,
            });
          }
        })
        .finally(() => {
          active -= 1;
          entry.loading = false;
          pump();
        });
    }
  }

  const intersection = new view.IntersectionObserver(
    (changes) => {
      for (const change of changes) {
        const entry = entries.get(change.target as HTMLElement);
        if (!entry) continue;
        if (change.isIntersecting) visible.add(entry);
        else visible.delete(entry);
        if (change.isIntersecting && entry.deferred) {
          for (const old of entry.parent.querySelectorAll(':scope > .kyara-lite-meta'))
            old.remove();
          const meta = node(doc, 'span', 'kyara-lite-meta');
          meta.dataset.state = 'loading';
          const price = node(doc, 'span', 'kyara-lite-price');
          const value = node(doc, 'span', 'kyara-lite-value', '… ◆');
          const period = node(doc, 'span', 'kyara-lite-period', '10 ventes');
          price.append(value, period);
          meta.append(price);
          Object.assign(entry, { meta, price, value, period, deferred: false });
          entry.parent.append(meta);
          entry.row.classList.add('kyara-lite-card', 'kyara-lite-collection');
          const cached = service.peek(entry.id);
          if (cached) paint(entry, cached);
        }
      }
      pump();
    },
    { rootMargin: '0px' },
  );

  function remove(entry: Entry): void {
    intersection.unobserve(entry.row);
    visible.delete(entry);
    entry.meta?.remove();
    entry.row.classList.remove('kyara-lite-card', `kyara-lite-${entry.kind}`);
    entries.delete(entry.row);
  }

  function scan(): void {
    if (destroyed) return;
    for (const extra of extras) extra.scan();
    clearTimeout(scanTimer);
    const cards = surfaces();
    for (const entry of [...entries.values()]) {
      const card = cards.get(entry.row);
      if (
        !card ||
        card.parent !== entry.parent ||
        card.kind !== entry.kind ||
        idOf(entry.row) !== entry.id ||
        (!entry.deferred && entry.meta?.parentElement !== card.parent)
      ) {
        remove(entry);
      }
    }
    for (const card of cards.values()) {
      const id = idOf(card.row);
      if (id === null || entries.has(card.row)) continue;
      if (card.kind === 'collection') {
        entries.set(card.row, { ...card, id, deferred: true, loading: false, loaded: false });
        intersection.observe(card.row);
        continue;
      }
      // Un rendu du site peut copier une ligne déjà décorée : on ne garde que notre propre étiquette.
      for (const old of card.parent.querySelectorAll(':scope > .kyara-lite-meta')) old.remove();
      const meta = node(doc, 'span', 'kyara-lite-meta');
      meta.dataset.state = 'loading';
      const seriesOnly = card.kind === 'unified' && !!card.row.closest('[role="dialog"]');
      const entry: Entry = { ...card, id, meta, loading: false, loaded: false, deferred: false };
      if (!seriesOnly) {
        entry.price = node(doc, 'span', 'kyara-lite-price');
        entry.value = node(doc, 'span', 'kyara-lite-value', '… ◆');
        entry.period = node(doc, 'span', 'kyara-lite-period', 'méd.');
        entry.price.append(entry.value, entry.period);
        meta.append(entry.price);
      }
      if (card.details) {
        const needsName =
          ['want', 'market'].includes(card.kind) ||
          (card.kind === 'unified' && !card.row.querySelector('.nm'));
        if (needsName) {
          entry.name = node(
            doc,
            'span',
            'kyara-lite-name',
            card.row.querySelector('img')?.alt || card.row.title || `Carte #${id}`,
          );
          meta.append(entry.name);
        }
        if (!seriesOnly) {
          entry.rarity = node(doc, 'span', 'kyara-lite-rarity', 'Rareté inconnue');
          meta.append(entry.rarity);
        }
        entry.series = node(doc, 'span', 'kyara-lite-series', 'Chargement de la série…');
        meta.append(entry.series);
      }
      card.row.classList.add('kyara-lite-card', `kyara-lite-${card.kind}`);
      card.parent.append(meta);
      entries.set(card.row, entry);
      const cached = service.peek(id);
      if (cached) paint(entry, cached);
      intersection.observe(card.row);
    }
    manualRefresh();
    pump();
  }

  // --- Bouton « Actualiser » de la page des offres, avec filtres conservés.
  const filtersKey = () => `kyara-lite:offers-filters:v1:${location.pathname}${location.search}`;
  let restoring = false;
  let restored = false;

  const buttonKey = (button: Element): string => {
    const copy = button.cloneNode(true) as Element;
    copy.querySelectorAll('.n').forEach((element) => element.remove());
    return (copy.textContent ?? '').replace(/\s+/g, ' ').trim();
  };

  function saveFilters(filters: Element): void {
    const state = {
      search: filters.querySelector<HTMLInputElement>('input[type="search"]')?.value || '',
      buttons: Object.fromEntries(
        [...filters.querySelectorAll('button[aria-pressed]')]
          .filter((button) => !button.closest('.kyara-plus-offers-tools'))
          .map((b) => [buttonKey(b), b.getAttribute('aria-pressed') === 'true']),
      ),
    };
    try {
      view.sessionStorage.setItem(filtersKey(), JSON.stringify(state));
    } catch {
      // Stockage de session indisponible : les filtres ne seront simplement pas restaurés.
    }
  }

  async function restoreFilters(): Promise<void> {
    if (restoring || restored) return;
    let saved: { search: string; buttons: Record<string, boolean> };
    try {
      const raw = view.sessionStorage.getItem(filtersKey());
      if (!raw) {
        restored = true;
        return;
      }
      saved = JSON.parse(raw);
      if (
        !saved ||
        typeof saved.search !== 'string' ||
        !saved.buttons ||
        typeof saved.buttons !== 'object'
      ) {
        view.sessionStorage.removeItem(filtersKey());
        restored = true;
        return;
      }
    } catch {
      restored = true;
      return;
    }
    const findFilters = () => doc.querySelector('.board .filters');
    const filters = findFilters();
    if (!filters?.querySelector('input[type="search"]')) return;
    const available = new Set(
      [...filters.querySelectorAll('button[aria-pressed]')]
        .filter((button) => !button.closest('.kyara-plus-offers-tools'))
        .map(buttonKey),
    );
    if (Object.keys(saved.buttons).some((key) => !available.has(key))) return;

    restoring = true;
    const nextRender = () => new Promise<void>((resolve) => view.setTimeout(resolve, 0));
    try {
      for (const [key, pressed] of Object.entries(saved.buttons)) {
        const button = [
          ...(findFilters()?.querySelectorAll<HTMLButtonElement>('button[aria-pressed]') ?? []),
        ]
          .filter((item) => !item.closest('.kyara-plus-offers-tools'))
          .find((item) => buttonKey(item) === key);
        if (!button || button.disabled) return;
        if ((button.getAttribute('aria-pressed') === 'true') !== pressed) {
          button.click();
          await nextRender();
        }
      }
      const input = findFilters()?.querySelector<HTMLInputElement>('input[type="search"]');
      if (!input) return;
      input.value = saved.search;
      input.dispatchEvent(new view.Event('input', { bubbles: true }));
      input.dispatchEvent(new view.Event('change', { bubbles: true }));
      restored = true;
      view.sessionStorage.removeItem(filtersKey());
    } catch {
      // Restauration impossible : on laisse la page telle quelle.
    } finally {
      restoring = false;
    }
  }

  function manualRefresh(): void {
    const board = isOffersPage(location.href) ? doc.querySelector('.board') : null;
    if (!board) {
      refreshButton?.remove();
      refreshButton = null;
      return;
    }
    void restoreFilters();
    const native = [...board.querySelectorAll('button')].find(
      (button) =>
        button !== refreshButton && /^↻ Actualiser$/.test((button.textContent ?? '').trim()),
    );
    if (native) {
      refreshButton?.remove();
      refreshButton = null;
      return;
    }
    if (refreshButton?.isConnected) return;
    const button = node(doc, 'button', 'kyara-lite-refresh', '↻ Actualiser') as HTMLButtonElement;
    refreshButton = button;
    button.type = 'button';
    button.title = 'Recharger la page en conservant la recherche et les filtres.';
    button.addEventListener('click', async () => {
      const filters = doc.querySelector('.board .filters');
      if (filters) saveFilters(filters);
      button.disabled = true;
      try {
        await service.flush();
      } catch {
        // Écriture du cache impossible : on recharge quand même.
      } finally {
        location.reload();
      }
    });
    (board.querySelector('.filters') || board.firstElementChild)?.after(button);
  }

  const schedule = () => {
    if (destroyed) return;
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, 100);
  };

  const mutation = new view.MutationObserver((changes) => {
    const relevant = changes.some((change) => {
      const target =
        change.target.nodeType === 1 ? (change.target as Element) : change.target.parentElement;
      if (target?.closest(OWNED_UI)) return false;
      if (change.type === 'attributes' && change.attributeName === 'class') {
        return !!target?.matches('.tcg') && !!target.closest('.wrap.body .cell');
      }
      const changed = [...change.addedNodes, ...change.removedNodes];
      if (
        change.type === 'childList' &&
        target?.closest('.qty, .chak, a.thumb, .side > .sk, .tray > header h3') &&
        changed.some((item) => item.nodeType === 3)
      ) {
        return true;
      }
      if (change.type === 'characterData') {
        return !!target?.closest('.delta, .qty, .chak, .thumb, .side > .sk, .tray > header h3');
      }
      return (
        change.type === 'attributes' ||
        changed.some(
          (item) =>
            item.nodeType === 1 && !(item as Element).matches(`${OWNED_UI}, .kyara-lite-refresh`),
        )
      );
    });
    if (relevant) schedule();
  });
  mutation.observe(doc.documentElement, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: [
      'href',
      'src',
      'disabled',
      'aria-disabled',
      'class',
      'aria-pressed',
      'aria-selected',
    ],
  });
  doc.addEventListener('input', schedule);
  doc.addEventListener('change', schedule);
  doc.addEventListener('visibilitychange', () => {
    scan();
    pump();
  });
  view.addEventListener('popstate', schedule);
  view.addEventListener('hashchange', schedule);
  void service.ready.then(() => {
    if (!destroyed) scan();
  });
  scan();

  return {
    scan,
    destroy(): void {
      destroyed = true;
      mutation.disconnect();
      intersection.disconnect();
      clearTimeout(scanTimer);
      clearTimeout(startTimer);
      for (const extra of extras) extra.destroy?.();
      for (const entry of [...entries.values()]) remove(entry);
      refreshButton?.remove();
      service.destroy();
    },
  };
}
