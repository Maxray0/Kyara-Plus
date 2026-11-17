import { h } from '../dom';
import alertBellCss from '../alerts/bell.css?inline';
import panelCss from './panel.css?inline';

export interface PanelView {
  id: string;
  label: string;
  render: () => HTMLElement;
  /** Arrête les abonnements et minuteries de la vue courante. */
  destroy?: () => void;
}

export interface PanelStatus {
  label: string;
  ok: boolean;
}

export interface PanelOptions {
  views: readonly PanelView[];
  initialView?: string;
  getStatus?: () => PanelStatus;
  onSettings?: () => void;
  /** Cloche locale rendue dans l'en-tête, avant les autres actions. */
  alertBell?: HTMLElement;
  tagline?: string;
}

export interface PanelController {
  host: HTMLElement;
  root: ShadowRoot;
  open: () => void;
  close: () => void;
  toggle: () => void;
  destroy: () => void;
}

function isField(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.matches('input, select, textarea') || target.isContentEditable)
  );
}

const DOCK_GAP = 12;
const DOCK_MIN_WIDTH = 360;
/** Événement interne : les vues peuvent suspendre leurs minuteries quand le panneau se ferme. */
export const PANEL_VISIBILITY_EVENT = 'kyara-plus:panel-visibility';

export interface PanelDock {
  docked: boolean;
  left: number | null;
}

/**
 * Le panneau occupe la gouttière droite du contenu Kyara quand elle est assez large.
 * Sinon il reste un tiroir flottant de 420 px ancré à droite.
 */
export function panelDock(
  anchorRight: number,
  viewportWidth: number,
  gap = DOCK_GAP,
  minWidth = DOCK_MIN_WIDTH,
): PanelDock {
  const available = viewportWidth - anchorRight - gap * 2;
  if (!Number.isFinite(anchorRight) || anchorRight <= 0 || available < minWidth) {
    return { docked: false, left: null };
  }
  return { docked: true, left: Math.round(anchorRight + gap) };
}

/**
 * Panneau injecté sur kyara.games. Le lanceur reste discret, le tiroir est isolé
 * dans un shadow DOM ouvert et chaque section est fournie par un `PanelView`.
 */
export function createPanel(options: PanelOptions): PanelController {
  const first = options.views.find((view) => view.id === options.initialView) ?? options.views[0];
  if (!first) throw new Error('Au moins une vue est nécessaire');

  // Le logo SVG est exposé aux pages Kyara par le manifeste.
  const logoSrc = browser.runtime.getURL('/icon/kyara-plus.svg');
  const logo = (): HTMLImageElement =>
    h('img', {
      class: 'kui-glyph kui-logo',
      src: logoSrc,
      alt: '',
      width: '42',
      height: '42',
      'aria-hidden': 'true',
    }) as HTMLImageElement;

  const host = h('div', { id: 'kyara-plus-ui' });
  const root = host.attachShadow({ mode: 'open' });
  let layoutObserver: ResizeObserver | null = null;
  const style = document.createElement('style');
  style.textContent = `${panelCss}\n${alertBellCss}`;
  root.append(style);

  let activeId = first.id;
  let activeView: PanelView | null = null;
  let open = false;
  let previousFocus: HTMLElement | null = null;
  const tabButtons: HTMLButtonElement[] = [];

  const launcher = h(
    'button',
    {
      type: 'button',
      class: 'kui-launcher',
      'aria-expanded': 'false',
      'aria-controls': 'kui-panel',
      'aria-label': 'Ouvrir Kyara Plus',
    },
    logo(),
    h(
      'span',
      { class: 'kui-launcher-copy' },
      h('b', {}, 'Kyara Plus'),
      h('small', {}, options.tagline ?? 'Vente · échanges · statistiques'),
    ),
  ) as HTMLButtonElement;

  const statusDot = h('span', { class: 'kui-dot', 'aria-hidden': 'true' });
  const statusText = h('span', { class: 'kui-status-text' }, 'Prêt');
  const settings = options.onSettings
    ? (h(
        'button',
        {
          type: 'button',
          class: 'kui-icon kui-settings',
          title: 'Réglages',
          'aria-label': 'Réglages',
        },
        '⚙',
      ) as HTMLButtonElement)
    : null;
  const closeButton = h(
    'button',
    { type: 'button', class: 'kui-icon kui-close', title: 'Fermer', 'aria-label': 'Fermer' },
    '×',
  );

  const tabs = h('nav', {
    class: 'kui-tabs',
    role: 'tablist',
    'aria-label': 'Sections de Kyara Plus',
    'aria-orientation': 'horizontal',
  });
  const viewHost = h('div', {
    class: 'kui-body',
    id: 'kui-body',
    role: 'tabpanel',
  });
  const footer = h(
    'footer',
    { class: 'kui-foot' },
    h('span', {}, 'Échap pour fermer'),
    h(
      'span',
      {},
      options.views.length > 1 ? `1–${options.views.length} pour changer de vue` : '1 vue',
    ),
  );

  const panel = h(
    'aside',
    {
      class: 'kui-panel',
      id: 'kui-panel',
      role: 'dialog',
      'aria-labelledby': 'kui-title',
      tabindex: '-1',
      'aria-hidden': 'true',
    },
    h(
      'header',
      { class: 'kui-head' },
      logo(),
      h(
        'div',
        { class: 'kui-brand' },
        h('h1', { id: 'kui-title' }, 'Kyara Plus'),
        h('div', { class: 'kui-status', role: 'status' }, statusDot, statusText),
      ),
      h('div', { class: 'kui-head-actions' }, options.alertBell ?? null, settings, closeButton),
    ),
    tabs,
    viewHost,
    footer,
  ) as HTMLElement;
  panel.toggleAttribute('inert', true);

  for (const view of options.views) {
    const tab = h(
      'button',
      {
        type: 'button',
        class: 'kui-tab',
        role: 'tab',
        id: `kui-tab-${view.id}`,
        'aria-controls': 'kui-body',
        'aria-selected': 'false',
        'data-view': view.id,
      },
      view.label,
    ) as HTMLButtonElement;
    tab.tabIndex = -1;
    tab.addEventListener('click', () => selectView(view.id));
    tabButtons.push(tab);
    tabs.append(tab);
  }

  tabs.addEventListener('keydown', (event) => {
    const index = tabButtons.indexOf(root.activeElement as HTMLButtonElement);
    if (index < 0) return;
    let next: number | undefined;
    if (event.key === 'ArrowRight') next = (index + 1) % tabButtons.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + tabButtons.length) % tabButtons.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabButtons.length - 1;
    else return;
    event.preventDefault();
    event.stopPropagation();
    if (next === undefined) return;
    const target = tabButtons[next];
    if (!target) return;
    selectView(target.dataset.view ?? '');
    target.focus();
  });

  function syncLayout(): void {
    // Le site actuel n’utilise plus `.wrap.body` : viser d’abord le conteneur
    // centré du contenu, jamais `<main>` qui occupe toute la largeur.
    const anchor =
      document.querySelector<HTMLElement>('.wrap.body') ??
      document.querySelector<HTMLElement>('main.wrap') ??
      document.querySelector<HTMLElement>('main .wrap') ??
      document.querySelector<HTMLElement>('.wrap') ??
      document.querySelector<HTMLElement>('main');
    const anchorRight = anchor?.getBoundingClientRect().right ?? 0;
    const dock = panelDock(anchorRight, window.innerWidth);
    const docked = dock.docked && window.innerWidth > 720;
    host.classList.toggle('kui-docked', docked);
    if (docked && dock.left !== null) {
      host.style.setProperty('--kui-dock-left', `${dock.left}px`);
    } else {
      host.style.removeProperty('--kui-dock-left');
    }
  }

  function refreshStatus(): void {
    const status = options.getStatus?.() ?? { label: 'Prêt', ok: true };
    statusText.textContent = status.label;
    statusDot.classList.toggle('ok', status.ok);
  }

  function selectView(id: string): void {
    const view = options.views.find((item) => item.id === id);
    if (!view) return;
    activeView?.destroy?.();
    activeView = view;
    activeId = view.id;
    for (const tab of tabButtons) {
      const selected = tab.dataset.view === view.id;
      tab.classList.toggle('on', selected);
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
    }
    viewHost.setAttribute('aria-labelledby', `kui-tab-${view.id}`);
    viewHost.replaceChildren(view.render());
    if (open) viewHost.scrollTop = 0;
  }

  function setOpen(next: boolean, trigger?: HTMLElement): void {
    if (open === next) return;
    open = next;
    if (next) syncLayout();
    host.classList.toggle('is-open', open);
    document.dispatchEvent(new CustomEvent<boolean>(PANEL_VISIBILITY_EVENT, { detail: open }));
    launcher.setAttribute('aria-expanded', String(open));
    launcher.toggleAttribute('inert', open);
    panel.toggleAttribute('inert', !open);
    panel.setAttribute('aria-hidden', String(!open));
    if (open) {
      const active = root.activeElement ?? document.activeElement;
      previousFocus = trigger ?? (active instanceof HTMLElement ? active : null);
      refreshStatus();
      panel.focus();
    } else {
      const target = previousFocus;
      previousFocus = null;
      if (target?.isConnected) target.focus();
    }
  }

  const onKeydown = (event: KeyboardEvent): void => {
    if (!open) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (isField(root.activeElement) || isField(event.target)) return;
    // Le panneau n'est pas modal : les chiffres restent au site quand le focus est sorti.
    if (!event.composedPath().includes(panel)) return;
    const view = options.views[Number(event.key) - 1];
    if (!view) return;
    event.preventDefault();
    selectView(view.id);
  };

  launcher.addEventListener('click', () => setOpen(true, launcher));
  settings?.addEventListener('click', () => options.onSettings?.());
  closeButton.addEventListener('click', () => setOpen(false));
  document.addEventListener('keydown', onKeydown);

  root.append(h('div', { class: 'kui' }, launcher, panel));
  (document.body ?? document.documentElement).append(host);
  window.addEventListener('resize', syncLayout);
  if (typeof ResizeObserver !== 'undefined') {
    layoutObserver = new ResizeObserver(syncLayout);
    layoutObserver.observe(document.documentElement);
    if (document.body) layoutObserver.observe(document.body);
  }
  syncLayout();
  selectView(activeId);

  return {
    host,
    root,
    open: () => setOpen(true),
    close: () => setOpen(false),
    toggle: () => setOpen(!open),
    destroy: () => {
      activeView?.destroy?.();
      activeView = null;
      document.removeEventListener('keydown', onKeydown);
      window.removeEventListener('resize', syncLayout);
      layoutObserver?.disconnect();
      host.remove();
    },
  };
}
