import { h } from '../dom';
import { unreadAlertCount, type Alert, type AlertKind } from './model';
import { alertsItem, loadAlerts, markAlertRead, markAllAlertsRead } from './store';

type AlertFilter = 'all' | 'wishlist' | 'trade' | 'market';

export interface AlertBellStore {
  load: (now?: number) => Promise<Alert[]>;
  markRead: (key: string, read?: boolean, now?: number) => Promise<Alert[]>;
  markAllRead: (now?: number) => Promise<Alert[]>;
  watch: (listener: () => void) => () => void;
}

export interface AlertBellOptions {
  now?: () => number;
  store?: AlertBellStore;
}

const defaultStore: AlertBellStore = {
  load: loadAlerts,
  markRead: markAlertRead,
  markAllRead: markAllAlertsRead,
  watch: (listener) => alertsItem.watch(() => listener()),
};

const FILTERS: readonly { id: AlertFilter; label: string }[] = [
  { id: 'all', label: 'Toutes' },
  { id: 'wishlist', label: 'Envies' },
  { id: 'trade', label: 'Échanges' },
  { id: 'market', label: 'Veille' },
];

const KIND_LABEL: Record<AlertKind, string> = {
  wishlist: 'Envie',
  trade: 'Échange',
  market: 'Marché',
  order: 'Ordre',
};

function countLabel(count: number): string {
  return count > 99 ? '99+' : String(count);
}

function dateLabel(at: number): string {
  return new Date(at).toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function filterAlert(alert: Alert, filter: AlertFilter): boolean {
  return filter === 'all' || alert.kind === filter;
}

/** Même pictogramme linéaire que la cloche native du site, au lieu d'un emoji. */
function bellGlyph(): HTMLElement {
  const span = h('span', { class: 'kui-alert-bell-glyph', 'aria-hidden': 'true' });
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  for (const d of ['M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9', 'M10.3 21a1.94 1.94 0 0 0 3.4 0']) {
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  span.append(svg);
  return span;
}

/**
 * Cloche locale : elle ne crée aucune notification système et ne fait aucun appel réseau.
 * Le store est injectable pour tester le rendu sans dépendre du stockage de l'extension.
 */
export function createAlertBell(options: AlertBellOptions = {}): {
  element: HTMLElement;
  ready: Promise<void>;
  destroy: () => void;
} {
  const now = options.now ?? Date.now;
  const store = options.store ?? defaultStore;
  let alerts: Alert[] = [];
  let filter: AlertFilter = 'all';
  let open = false;
  let destroyed = false;
  // Une lecture lancée avant une écriture ne doit pas repasser après elle.
  let revision = 0;
  let resolveReady: () => void = () => undefined;
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });

  const badge = h('span', {
    class: 'kui-alert-bell-count',
    'aria-live': 'polite',
    hidden: true,
  });
  const button = h(
    'button',
    {
      type: 'button',
      class: 'kui-alert-bell-button',
      title: 'Alertes locales',
      'aria-label': 'Alertes locales',
      'aria-expanded': 'false',
      'aria-controls': 'kui-alert-popover',
    },
    bellGlyph(),
    badge,
  ) as HTMLButtonElement;

  const count = h('span', { class: 'kui-alert-popover-count' });
  const markAll = h(
    'button',
    { type: 'button', class: 'kui-alert-read-all' },
    'Tout lire',
  ) as HTMLButtonElement;
  const filterButtons = FILTERS.map(({ id, label }) => {
    const button = h(
      'button',
      { type: 'button', class: 'kui-alert-filter', 'data-filter': id },
      h('span', {}, label),
      h('span', { class: 'kui-alert-filter-count' }),
    ) as HTMLButtonElement;
    button.addEventListener('click', () => {
      filter = id;
      paint();
    });
    return { id, button };
  });
  const list = h('ul', { class: 'kui-alert-list' });
  const empty = h('p', { class: 'kui-alert-empty' });
  const popover = h(
    'div',
    {
      class: 'kui-alert-popover',
      id: 'kui-alert-popover',
      role: 'region',
      'aria-label': 'Alertes locales',
      hidden: true,
    },
    h('div', { class: 'kui-alert-popover-head' }, h('strong', {}, 'Alertes'), count, markAll),
    h(
      'div',
      { class: 'kui-alert-filters', role: 'group', 'aria-label': 'Filtrer les alertes' },
      ...filterButtons.map((entry) => entry.button),
    ),
    list,
    empty,
  );
  const root = h('div', { class: 'kui-alert-bell' }, button, popover);

  function focusInside(): boolean {
    const activeRoot = root.getRootNode();
    const active =
      activeRoot instanceof ShadowRoot ? activeRoot.activeElement : document.activeElement;
    return active instanceof HTMLElement && root.contains(active);
  }

  function setOpen(next: boolean): void {
    if (open === next) return;
    open = next;
    button.setAttribute('aria-expanded', String(open));
    popover.hidden = !open;
    root.classList.toggle('is-open', open);
    if (!open && focusInside()) button.focus();
  }

  function apply(next: Alert[], ticket: number): void {
    if (destroyed || ticket !== revision) return;
    alerts = next;
    paint();
  }

  function commit(promise: Promise<Alert[]>): void {
    const ticket = ++revision;
    void promise.then((next) => apply(next, ticket)).catch(() => undefined);
  }

  function paint(): void {
    // La cloche ne montre que les cartes de la liste d'envies ; les autres alertes
    // locales restent stockées mais n'encombrent plus l'affichage.
    const wishAlerts = alerts.filter((alert) => alert.wishlist === true);
    const unread = unreadAlertCount(wishAlerts);
    badge.textContent = countLabel(unread);
    badge.hidden = unread === 0;
    button.setAttribute(
      'aria-label',
      unread ? `Alertes locales, ${unread} non lue(s)` : 'Alertes locales',
    );
    count.textContent = `${wishAlerts.length} alerte(s)`;
    markAll.disabled = unread === 0;

    for (const entry of filterButtons) {
      const total = wishAlerts.filter((alert) => filterAlert(alert, entry.id)).length;
      entry.button.classList.toggle('on', filter === entry.id);
      entry.button.setAttribute('aria-pressed', String(filter === entry.id));
      const value = entry.button.querySelector('.kui-alert-filter-count');
      if (value) value.textContent = String(total);
    }

    const visible = wishAlerts.filter((alert) => filterAlert(alert, filter));
    if (!visible.length) {
      list.replaceChildren();
      empty.textContent = wishAlerts.length
        ? 'Aucune alerte dans ce filtre.'
        : 'Aucune alerte pour le moment. Les cartes de tes envies mises en vente apparaîtront ici.';
      empty.hidden = false;
      return;
    }

    empty.hidden = true;
    list.replaceChildren(
      ...visible.map((alert) => {
        const toggle = h(
          'button',
          {
            type: 'button',
            class: 'kui-alert-toggle',
            'aria-label': `${alert.read ? 'Marquer non lue' : 'Marquer lue'} : ${alert.title}`,
          },
          alert.read ? 'Marquer non lu' : 'Marquer lu',
        ) as HTMLButtonElement;
        toggle.addEventListener('click', () =>
          commit(store.markRead(alert.key, !alert.read, now())),
        );

        return h(
          'li',
          {
            class: `kui-alert-item${alert.read ? '' : ' is-unread'}${
              alert.cardId ? ' has-card' : ''
            }`,
          },
          alert.cardId
            ? h('img', {
                class: 'kui-alert-thumb',
                src: `https://kyara.games/cards/sm/${alert.cardId}.webp`,
                alt: '',
                width: '36',
                height: '50',
                loading: 'lazy',
                decoding: 'async',
              })
            : null,
          h(
            'div',
            { class: 'kui-alert-body' },
            h(
              'div',
              { class: 'kui-alert-item-head' },
              h('span', { class: 'kui-alert-kind' }, KIND_LABEL[alert.kind]),
              h('time', { datetime: new Date(alert.at).toISOString() }, dateLabel(alert.at)),
            ),
            h('b', { class: 'kui-alert-title' }, alert.title),
            h('p', { class: 'kui-alert-message' }, alert.message),
            h(
              'div',
              { class: 'kui-alert-item-actions' },
              toggle,
              alert.href
                ? h(
                    'a',
                    {
                      class: 'kui-alert-link',
                      href: alert.href,
                      target: '_blank',
                      rel: 'noreferrer',
                    },
                    'Voir l’offre',
                  )
                : null,
            ),
          ),
        );
      }),
    );
  }

  async function refresh(): Promise<void> {
    const ticket = ++revision;
    try {
      apply(await store.load(now()), ticket);
    } catch {
      // Le stockage par défaut ne rejette pas ; un store injecté peut le faire.
    }
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || !open) return;
    // La cloche se ferme avant le panneau qui la contient.
    event.preventDefault();
    event.stopPropagation();
    setOpen(false);
  }

  function onPointerDown(event: PointerEvent): void {
    if (!open || event.composedPath().includes(root)) return;
    setOpen(false);
  }

  button.addEventListener('click', () => setOpen(!open));
  markAll.addEventListener('click', () => commit(store.markAllRead(now())));
  root.addEventListener('keydown', onKeydown);
  document.addEventListener('pointerdown', onPointerDown, true);
  const stopWatch = store.watch(() => void refresh());
  void refresh().finally(resolveReady);

  return {
    element: root,
    ready,
    destroy: () => {
      destroyed = true;
      stopWatch();
      root.removeEventListener('keydown', onKeydown);
      document.removeEventListener('pointerdown', onPointerDown, true);
    },
  };
}
