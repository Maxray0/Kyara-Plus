import { AuthError, PassRequiredError } from '@/lib/api';
import { createAlertBell } from '@/lib/alerts/bell';
import { recordTradeAlerts } from '@/lib/alerts/sources';
import { sessionItem } from '@/lib/auth';
import { getCatalog } from '@/lib/catalog';
import { fill, fmt, h, imageUrl } from '@/lib/dom';
import {
  appendActivity,
  activityItem,
  getActivity,
  loadActivitySnapshot,
  refreshActivitySnapshot,
  type ActivitySnapshot,
} from '@/lib/doublons/activity';
import {
  applyPrice,
  buildCandidates,
  estimatePrices,
  sortCandidates,
  type Candidate,
  type CardMeta,
} from '@/lib/doublons/candidates';
import {
  ShapeError,
  clearShapeChanges,
  getMarket,
  sellPricesItem,
  shapeChangesItem,
  type Listing,
} from '@/lib/doublons/market';
import { gameActions } from '@/lib/doublons/actions';
import { fillSelection, listedCounts, type LogKind } from '@/lib/doublons/sell';
import { salesItem, type SalesSummary } from '@/lib/doublons/sales';
import { withExcludedId } from '@/lib/doublons/protection';
import { TradeRefresh } from '@/lib/doublons/trade-refresh';
import {
  PRESETS,
  getSellSettings,
  normalizeSellSettings,
  sellSettingsItem,
  type SellSettings,
} from '@/lib/doublons/settings';
import { createRelayClient } from '@/lib/relay';
import {
  getTradeSettings,
  normalizeTradeSettings,
  tradeSettingsItem,
  type TradeSettings,
} from '@/lib/doublons/trade-settings';
import {
  loadTradeBoard,
  noDealReason,
  type TradeBoard,
  type TradeDeal,
  type TradeOffer,
} from '@/lib/doublons/trades';
import { loadWishlist } from '@/lib/doublons/wishlist';
import type { CatalogCard } from '@/lib/stats/model';

const api = createRelayClient({
  queryTabs: () => browser.tabs.query({ url: 'https://kyara.games/*' }),
  sendToTab: (tabId, request) => browser.tabs.sendMessage(tabId, request),
});

const alertBell = createAlertBell();
document.getElementById('alert-bell')?.append(alertBell.element);

const ARM_MS = 4000;
let settings: SellSettings;
let list: Candidate[] = [];
let activeListings: Listing[] = [];
const meta = new Map<number, Partial<CardMeta>>();
let active = 0;
let busy = false;
let tradeSettings: TradeSettings;
let trades: TradeBoard | null = null;
let tradesLoadedAt: number | null = null;
let tradeAutoRefresh: TradeRefresh | null = null;
let currentTab: Tab = 'sell';
let wishes = new Set<number>();
let tradesBusy = false;
let wishesBusy = false;
let wishesLoaded = false;
let acceptingId: string | null = null;
let activitySeq = 0;
let activityBusy = false;
let activityTimer: ReturnType<typeof setTimeout> | undefined;

function rememberCatalog(cards: readonly CatalogCard[]): void {
  for (const card of cards) {
    meta.set(Number(card.id), {
      name: card.name ?? null,
      image: card.image ?? null,
      rarity: card.rarity,
      series: card.series,
    });
  }
}

const $ = (id: string) => document.getElementById(id) as HTMLElement;

function setStatus(message: string, isError = false): void {
  const el = $('status');
  el.textContent = message;
  el.className = isError ? 'error' : '';
}

function log(message: string, kind: LogKind = 'info'): void {
  const item = h('li', { class: kind }, `${new Date().toLocaleTimeString('fr-FR')} · ${message}`);
  $('log').prepend(item);
  void appendActivity(message, kind);
}

function explain(error: unknown): string {
  if (error instanceof AuthError) return 'Session expirée : ouvre kyara.games puis réessaie.';
  if (error instanceof PassRequiredError) {
    return 'Kyara demande une vérification : effectue une action à la main sur kyara.games, puis réessaie.';
  }
  if (error instanceof ShapeError) {
    return `${error.message} : les ventes sont en pause en attendant une mise à jour.`;
  }
  return error instanceof Error ? error.message : 'erreur inconnue';
}

/** Un premier clic arme le bouton, le second dans les 4 s exécute l'action. */
function armable(
  label: string,
  armedLabel: string,
  action: () => void | Promise<void>,
): HTMLElement {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const button = h('button', { type: 'button' }, label);
  button.addEventListener('click', (event) => {
    // Seuls de vrais clics comptent : un script de la page ne peut pas déclencher l'action.
    if (!event.isTrusted) return;
    if (!button.classList.contains('armed')) {
      button.classList.add('armed');
      button.textContent = armedLabel;
      timer = setTimeout(() => {
        button.classList.remove('armed');
        button.textContent = label;
      }, ARM_MS);
      return;
    }
    clearTimeout(timer);
    button.classList.remove('armed');
    button.textContent = label;
    void action();
  });
  return button;
}

function renderSlots(): void {
  const free = Math.max(0, settings.maxSlots - active);
  $('slots').textContent =
    `Annonces actives : ${fmt(active)} / ${fmt(settings.maxSlots)} · ` +
    `${fmt(free)} emplacement(s) libre(s)`;
  updateFillButton();
}

function updateFillButton(): void {
  const button = document.getElementById('fill') as HTMLButtonElement | null;
  if (!button) return;
  const selected = list.filter((c) => c.checked && !c.blocked && c.sellable > 0).length;
  button.disabled = busy || selected === 0 || active >= settings.maxSlots;
  button.textContent = selected
    ? `Remplir les emplacements (${fmt(selected)})`
    : 'Remplir les emplacements';
}

function listingName(listing: Listing): string {
  return listing.name ?? meta.get(listing.characterId)?.name ?? `Carte #${listing.characterId}`;
}

function endsLabel(value: string | null): string {
  if (!value) return '—';
  const ends = Date.parse(value);
  if (!Number.isFinite(ends)) return '—';
  const minutes = Math.ceil((ends - Date.now()) / 60_000);
  if (minutes <= 0) return 'terminée';
  if (minutes < 60) return `${fmt(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${fmt(hours)} h ${String(minutes % 60).padStart(2, '0')}`;
  return `${fmt(Math.floor(hours / 24))} j ${hours % 24} h`;
}

function renderActive(): void {
  const box = $('active-list');
  const count = $('active-count');
  count.textContent = `${fmt(activeListings.length)} annonce(s)`;
  if (!activeListings.length) {
    fill(
      box,
      h(
        'p',
        { class: 'muted' },
        'Aucune annonce active. Les cartes mises en vente apparaîtront ici.',
      ),
    );
    return;
  }
  const head = h(
    'tr',
    {},
    ...['Carte', 'Prix actuel', 'Fin', 'Nouveau prix', ''].map((label) => h('th', {}, label)),
  );
  const rows = activeListings.map((listing) => {
    const name = listingName(listing);
    const image = imageUrl(
      listing.image ??
        meta.get(listing.characterId)?.image ??
        `/cards/sm/${listing.characterId}.webp`,
    );
    const adjustable = listing.type !== 'auction';
    const input = h('input', {
      type: 'number',
      min: '1',
      value: String(listing.price),
      disabled: !adjustable,
      'aria-label': `Nouveau prix pour ${name}`,
    }) as HTMLInputElement;
    const adjust = adjustable
      ? armable('Ajuster', 'Confirmer le prix', () => repriceActive(listing, input.value))
      : h(
          'button',
          { type: 'button', disabled: true, title: 'Une enchère ne peut pas être ajustée' },
          'Ajuster',
        );
    const cancel = armable('Annuler', 'Confirmer l’annulation', () => cancelActive(listing));
    cancel.className = 'danger';
    return h(
      'tr',
      {},
      h(
        'td',
        {},
        h(
          'div',
          { class: 'card' },
          image && h('img', { src: image, alt: '', loading: 'lazy' }),
          h(
            'div',
            {},
            h('b', {}, name),
            h(
              'small',
              {},
              [listing.rarity, listing.type === 'auction' ? 'enchère' : 'prix fixe']
                .filter(Boolean)
                .join(' · '),
            ),
          ),
        ),
      ),
      h('td', {}, `${fmt(listing.price)} ◆`),
      h('td', { title: listing.endsAt ?? '' }, endsLabel(listing.endsAt)),
      h('td', {}, input),
      h('td', {}, h('div', { class: 'cell-actions' }, adjust, cancel)),
    );
  });
  fill(box, h('table', {}, h('thead', {}, head), h('tbody', {}, ...rows)));
}

function renderTable(): void {
  const table = $('table');
  table.hidden = list.length === 0;
  const selectable = list.filter((c) => !c.blocked && c.sellable > 0);
  const selectAll = h('input', {
    type: 'checkbox',
    'aria-label': 'Tout sélectionner',
  }) as HTMLInputElement;
  selectAll.disabled = selectable.length === 0;
  selectAll.checked = selectable.length > 0 && selectable.every((c) => c.checked);
  selectAll.indeterminate = !selectAll.checked && selectable.some((c) => c.checked);
  selectAll.addEventListener('change', () => {
    for (const c of selectable) c.checked = selectAll.checked;
    renderTable();
  });
  const head = h(
    'tr',
    {},
    h('th', {}, selectAll),
    ...['Carte', 'Exemplaires', 'Prix conseillé', 'État', ''].map((label) => h('th', {}, label)),
  );
  const rows = list.map((c) => {
    const checkbox = h('input', {
      type: 'checkbox',
      'aria-label': `Sélectionner ${c.name ?? `la carte #${c.id}`}`,
    }) as HTMLInputElement;
    checkbox.checked = !!c.checked;
    checkbox.disabled = !!c.blocked || c.sellable <= 0;
    checkbox.addEventListener('change', () => {
      c.checked = checkbox.checked;
      updateFillButton();
    });
    const src = imageUrl(c.image);
    const price = h('input', {
      type: 'number',
      min: '1',
      value: c.price ? String(c.price) : '',
      placeholder: '—',
      disabled: !!c.blocked && !c.manual,
      'aria-label': `Prix de ${c.name ?? c.id}`,
    }) as HTMLInputElement;
    price.addEventListener('change', () => {
      const value = Math.round(Number(price.value));
      if (value > 0) {
        c.price = value;
        c.manual = true;
      } else {
        c.manual = false;
        applyPrice(c, settings);
      }
      renderTable();
    });

    const canAct = !c.blocked && c.sellable > 0;
    const pinned = /cadenas|Verrouillée/i.test(c.blocked ?? '');
    const actions = h(
      'div',
      { class: 'cell-actions' },
      canAct && c.price
        ? armable('Vendre', 'Confirmer la vente', () => sell(c))
        : h('button', { type: 'button', disabled: true }, 'Vendre'),
      canAct
        ? armable(`Recycler ×${c.sellable}`, 'Confirmer le recyclage', () => recycle(c))
        : null,
      !pinned
        ? h(
            'button',
            {
              type: 'button',
              class: 'protect',
              title: 'Ne jamais vendre cette carte et poser le cadenas Kyara',
              onclick: () => void protect(c),
            },
            'Protéger',
          )
        : null,
    );
    return h(
      'tr',
      { class: c.blocked ? 'blocked' : '' },
      h('td', { class: 'select-cell' }, checkbox),
      h(
        'td',
        {},
        h(
          'div',
          { class: 'card' },
          src && h('img', { src, alt: '', loading: 'lazy' }),
          h(
            'div',
            {},
            h('b', {}, c.name ?? `Carte #${c.id}`),
            h('small', {}, [c.series, c.rarity].filter(Boolean).join(' · ')),
          ),
        ),
      ),
      h('td', {}, `${fmt(c.qty)} (${fmt(c.sellable)} vendable${c.sellable > 1 ? 's' : ''})`),
      h('td', {}, price, c.manual ? h('small', { class: 'muted' }, ' à la main') : null),
      h('td', { class: 'reason' }, c.blocked ?? c.status ?? c.priceWhy),
      h('td', {}, actions),
    );
  });
  fill(table, h('thead', {}, head), h('tbody', {}, ...rows));
  updateFillButton();
}

async function refreshSlots(): Promise<void> {
  const market = await getMarket(api);
  active = market.active.length;
  activeListings = market.active;
  renderSlots();
  renderActive();
}

async function load(options: { reportStatus?: boolean } = {}): Promise<boolean> {
  if (busy) return false;
  busy = true;
  const reportStatus = options.reportStatus !== false;
  if (reportStatus) setStatus('Lecture de ta collection…');
  try {
    const catalog = await getCatalog(api);
    rememberCatalog(catalog);
    const market = await getMarket(api);
    active = market.active.length;
    activeListings = market.active;
    const prices = new Map(
      Object.entries(await sellPricesItem.getValue()).map(([id, value]) => [Number(id), value]),
    );
    list = await buildCandidates(api, settings, {
      activeIds: new Set(market.active.map((l) => l.characterId)),
      listed: listedCounts(market.active),
      holds: market.holds,
      meta,
      prices,
    });
    list.forEach((c) => {
      c.checked = !c.blocked;
    });
    renderSlots();
    renderActive();
    renderTable();
    $('estimate').removeAttribute('disabled');
    const sellable = list.filter((c) => !c.blocked).length;
    if (reportStatus) {
      setStatus(`${fmt(list.length)} doublon(s), dont ${fmt(sellable)} vendable(s) maintenant.`);
    }
    return true;
  } catch (error) {
    if (reportStatus) setStatus(explain(error), true);
    return false;
  } finally {
    busy = false;
    updateFillButton();
  }
}

async function estimate(): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    await estimatePrices(api, settings, list, (done, total) =>
      setStatus(`Prix du marché… ${fmt(done)}/${fmt(total)}`),
    );
    renderTable();
    setStatus('Prix estimés. Tu peux corriger un prix à la main avant de vendre.');
  } catch (error) {
    setStatus(explain(error), true);
  } finally {
    busy = false;
  }
}

async function sell(c: Candidate): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    await refreshSlots();
    if (active >= settings.maxSlots) {
      setStatus(`Tes ${settings.maxSlots} emplacements sont déjà occupés.`, true);
      return;
    }
    const placed = await gameActions.sell(api, settings, [c], 1, {
      listed: listedCounts(activeListings),
      source: 'page Doublons',
      log,
      onUpdate: renderTable,
    });
    if (placed) {
      c.qty -= 1;
      c.sellable = Math.max(0, c.sellable - 1);
      await refreshSlots();
      setStatus(`${c.name ?? `Carte #${c.id}`} mis en vente.`);
    } else {
      setStatus(c.status || c.priceWhy || 'Non mis en vente.', true);
    }
  } catch (error) {
    setStatus(explain(error), true);
  } finally {
    busy = false;
    renderTable();
  }
}

async function recycle(c: Candidate): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    const qty = c.sellable;
    const result = await gameActions.recycle(api, c.id, qty);
    if (!result.ok) {
      setStatus(`Recyclage refusé : ${result.message}`, true);
      log(`${c.name ?? c.id} : recyclage refusé (${result.message})`, 'warn');
      return;
    }
    c.qty -= qty;
    c.sellable = 0;
    c.blocked = 'recyclé';
    log(`${c.name ?? `Carte #${c.id}`} : ${qty} exemplaire(s) recyclé(s)`, 'sale');
    setStatus('Recyclage effectué.');
  } catch (error) {
    setStatus(explain(error), true);
  } finally {
    busy = false;
    renderTable();
  }
}

async function fillSlots(): Promise<void> {
  if (busy) return;
  const selected = list.filter((c) => c.checked && !c.blocked && c.sellable > 0);
  if (!selected.length) {
    setStatus('Sélectionne au moins une carte vendable à remplir.', true);
    return;
  }

  busy = true;
  let placed = 0;
  let failure: unknown = null;
  try {
    await refreshSlots();
    const free = Math.max(0, settings.maxSlots - active);
    if (!free) {
      setStatus(`Tes ${settings.maxSlots} emplacements sont déjà occupés.`, true);
      return;
    }
    const todo = fillSelection(list, free);
    if (!todo.length) {
      setStatus('Aucune carte sélectionnée ne peut être mise en vente maintenant.', true);
      return;
    }
    placed = await gameActions.sell(api, settings, todo, free, {
      listed: listedCounts(activeListings),
      source: 'page Doublons (remplissage)',
      log,
      onUpdate: renderTable,
    });
  } catch (error) {
    failure = error;
  } finally {
    busy = false;
    updateFillButton();
  }

  if (failure) {
    setStatus(explain(failure), true);
    return;
  }

  const refreshed = await load({ reportStatus: false });
  const suffix = refreshed ? '' : ' La liste n’a pas pu être actualisée.';
  if (placed) setStatus(`${fmt(placed)} annonce(s) mise(s) en vente.${suffix}`);
  else setStatus(`Aucune annonce créée : regarde le journal.${suffix}`, true);
}

async function cancelActive(listing: Listing): Promise<void> {
  if (busy) return;
  const name = listingName(listing);
  busy = true;
  setStatus(`Annulation de l’annonce de ${name}…`);
  try {
    const result = await gameActions.cancel(api, listing.id);
    if (!result.ok) {
      setStatus(`Annulation refusée : ${result.message}`, true);
      return;
    }
    activeListings = activeListings.filter((item) => item.id !== listing.id);
    active = activeListings.length;
    renderSlots();
    renderActive();
    log(`Annonce de ${name} retirée.`, 'sale');
    busy = false;
    const refreshed = await load({ reportStatus: false });
    const suffix = refreshed ? '' : ' La liste n’a pas pu être actualisée.';
    setStatus(`Annonce de ${name} retirée.${suffix}`);
  } catch (error) {
    setStatus(explain(error), true);
  } finally {
    busy = false;
    updateFillButton();
  }
}

async function repriceActive(listing: Listing, rawPrice: string): Promise<void> {
  if (busy) return;
  if (listing.type === 'auction') {
    setStatus('Une enchère ne peut pas être ajustée : seule son annulation est possible.', true);
    return;
  }
  const target = Math.round(Number(rawPrice));
  if (!Number.isSafeInteger(target) || target < 1) {
    setStatus('Prix invalide : indique un montant entier positif.', true);
    return;
  }
  if (target === listing.price) {
    setStatus('Le nouveau prix est identique au prix actuel.', true);
    return;
  }

  const name = listingName(listing);
  busy = true;
  setStatus(`Ajustement de ${name} : ${fmt(listing.price)} → ${fmt(target)} ◆…`);
  try {
    const result = await gameActions.reprice(api, listing, target, settings, { log, gapMs: 0 });
    if (!result.cancelled) {
      setStatus(`Ajustement impossible : ${result.message}`, true);
      return;
    }
    activeListings = activeListings.filter((item) => item.id !== listing.id);
    active = activeListings.length;
    renderSlots();
    renderActive();
    busy = false;
    const refreshed = await load({ reportStatus: false });
    const suffix = refreshed ? '' : ' La liste n’a pas pu être actualisée.';
    if (result.listed) {
      log(`Annonce de ${name} ajustée à ${fmt(result.price ?? target)} ◆.`, 'sale');
      setStatus(`Annonce de ${name} ajustée à ${fmt(result.price ?? target)} ◆.${suffix}`);
    } else {
      log(`Annonce de ${name} retirée, mais pas remise en vente : ${result.message}`, 'warn');
      setStatus(
        `Annonce de ${name} retirée, mais pas remise en vente : ${result.message}.${suffix}`,
        true,
      );
    }
  } catch (error) {
    setStatus(explain(error), true);
  } finally {
    busy = false;
    updateFillButton();
  }
}

async function protect(c: Candidate): Promise<void> {
  if (busy) return;
  const name = c.name ?? `Carte #${c.id}`;
  busy = true;
  try {
    const next = withExcludedId(settings, c.id);
    await sellSettingsItem.setValue(next);
    settings = next;
    list = list.filter((item) => item.id !== c.id);
    renderSettings();
    renderTable();

    let problem = '';
    try {
      const result = await gameActions.pin(api, c.id, true);
      if (!result.ok) problem = result.message;
    } catch (error) {
      problem = explain(error);
    }

    if (problem) {
      log(`${name} : protection locale posée, cadenas Kyara refusé (${problem}).`, 'warn');
      setStatus(
        `${name} ne sera plus vendue, mais le cadenas Kyara n’a pas pu être posé : ${problem}`,
        true,
      );
    } else {
      log(`${name} protégée et verrouillée sur Kyara.`, 'sale');
      setStatus(`${name} ne sera plus vendue et porte le cadenas Kyara.`);
    }
  } catch (error) {
    setStatus(explain(error), true);
  } finally {
    busy = false;
    updateFillButton();
    renderTable();
  }
}

// ── Échanges et envies ──
type Tab = 'sell' | 'trades' | 'wishes' | 'activity';

function setTradeStatus(message: string, isError = false): void {
  const element = $('trades-status');
  element.textContent = message;
  element.className = isError ? 'error' : 'muted';
}

function setTradesRetry(visible: boolean): void {
  const button = $('trades-retry');
  if (button) button.hidden = !visible;
}

function setWishStatus(message: string, isError = false): void {
  const element = $('wish-status');
  element.textContent = message;
  element.className = isError ? 'error' : 'muted';
}

function setActivityStatus(message: string, isError = false): void {
  const element = $('activity-status');
  element.textContent = message;
  element.className = isError ? 'error' : 'muted';
}

function dayLabel(at: number): string {
  return new Date(at).toLocaleDateString('fr-FR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

function salesTile(label: string, period: { count: number; total: number }): HTMLElement {
  return h(
    'div',
    { class: 'tile' },
    h('small', {}, label),
    h('b', {}, `${fmt(period.total)} ◆`),
    h('span', {}, `${fmt(period.count)} vente${period.count > 1 ? 's' : ''}`),
  );
}

function salesChart(summary: SalesSummary): HTMLElement {
  const max = Math.max(0, ...summary.days.map((day) => day.total));
  const bars = summary.days.map((day) => {
    const bar = h('i', { class: day.total ? '' : 'zero' });
    bar.style.height =
      day.total && max ? `${Math.max(4, Math.round((day.total / max) * 100))}%` : '2%';
    return h(
      'div',
      {
        class: 'b',
        title: `${dayLabel(day.at)} : ${fmt(day.total)} ◆ · ${fmt(day.count)} vente${day.count > 1 ? 's' : ''}`,
      },
      day.total === max && max > 0 ? h('em', {}, fmt(day.total)) : null,
      bar,
    );
  });
  const labels = summary.days.map((day) =>
    h('span', {}, new Date(day.at).toLocaleDateString('fr-FR', { weekday: 'narrow' })),
  );
  return h(
    'div',
    { class: 'chart' },
    h('h3', {}, 'Ventes des 14 derniers jours'),
    h(
      'div',
      { class: 'bars', role: 'img', 'aria-label': 'Gains de vente par jour sur 14 jours' },
      ...bars,
    ),
    h('div', { class: 'days' }, ...labels),
  );
}

function topSales(summary: SalesSummary): HTMLElement | null {
  if (!summary.top.length) return null;
  return h(
    'div',
    { class: 'top3' },
    h('h3', {}, 'Meilleures ventes · 30 jours'),
    ...summary.top.map((sale) => {
      const image = sale.cardId > 0 ? imageUrl(`/cards/sm/${sale.cardId}.webp`) : null;
      return h(
        'div',
        { class: 'top-sale' },
        image && h('img', { src: image, alt: '', loading: 'lazy' }),
        h('span', { class: 'grow' }, sale.name ?? `Carte #${sale.cardId}`),
        h('span', { class: 'price' }, `${fmt(sale.price)} ◆`),
      );
    }),
  );
}

async function renderActivity(snapshot?: ActivitySnapshot): Promise<void> {
  const seq = ++activitySeq;
  try {
    const [loaded, entries] = await Promise.all([
      snapshot ? Promise.resolve(snapshot) : loadActivitySnapshot(),
      getActivity(),
    ]);
    if (seq !== activitySeq) return;
    const { sales, summary } = loaded;
    fill(
      $('activity-summary'),
      h(
        'div',
        { class: 'stats' },
        h(
          'div',
          { class: 'tiles' },
          salesTile("Aujourd'hui", summary.today),
          salesTile('7 jours', summary.week),
          salesTile('30 jours', summary.month),
        ),
        salesChart(summary),
        topSales(summary),
      ),
    );
    const logBox = $('activity-log');
    if (!entries.length) {
      fill(logBox, h('li', { class: 'muted' }, 'Aucune activité enregistrée pour le moment.'));
    } else {
      fill(
        logBox,
        ...[...entries].reverse().map((entry) =>
          h(
            'li',
            { class: entry.kind },
            h(
              'time',
              { datetime: new Date(entry.t).toISOString() },
              new Date(entry.t).toLocaleString('fr-FR', {
                dateStyle: 'short',
                timeStyle: 'short',
              }),
            ),
            h('span', {}, entry.text),
          ),
        ),
      );
    }
    setActivityStatus(
      sales.length
        ? `${fmt(sales.length)} vente(s) terminée(s) enregistrée(s).`
        : 'Aucune vente terminée enregistrée. Les ventes sont notées à chaque lecture du marché (Charger mes doublons ou vente automatique).',
    );
  } catch (error) {
    if (seq === activitySeq) setActivityStatus(explain(error), true);
  }
}

async function refreshMarketActivity(): Promise<void> {
  if (activityBusy) return;
  activityBusy = true;
  const button = $('load-activity') as HTMLButtonElement;
  button.disabled = true;
  setActivityStatus('Lecture du marché…');
  try {
    await renderActivity(await refreshActivitySnapshot(api));
  } catch (error) {
    setActivityStatus(explain(error), true);
  } finally {
    activityBusy = false;
    button.disabled = false;
  }
}

function scheduleActivityRender(): void {
  if (currentTab !== 'activity') return;
  clearTimeout(activityTimer);
  activityTimer = setTimeout(() => void renderActivity(), 50);
}

function showTab(tab: Tab): void {
  currentTab = tab;
  for (const name of ['sell', 'trades', 'wishes', 'activity'] as const) {
    const pane = $(`pane-${name}`);
    if (pane) pane.hidden = name !== tab;
    const button = $(`tab-${name}`);
    if (button) {
      button.classList.toggle('on', name === tab);
      button.setAttribute('aria-selected', String(name === tab));
    }
  }
  if (tab === 'trades') {
    syncTradeAutoRefresh();
    openTrades();
    maybeRefreshTrades();
  } else {
    syncTradeAutoRefresh();
  }
  if (tab === 'wishes') openWishes();
  if (tab === 'activity') void renderActivity();
}

function renderTradeSettings(): void {
  const form = $('trade-settings');
  const field = (label: string, control: HTMLElement) => h('label', {}, label, control);
  const number = (
    key: 'tradeTol' | 'tradeLastGain' | 'tradeRefreshMin',
    min: number,
    max: number,
  ) => {
    const input = h('input', {
      type: 'number',
      min: String(min),
      max: String(max),
      value: String(tradeSettings[key]),
    }) as HTMLInputElement;
    input.addEventListener('change', () => {
      if (key === 'tradeTol') void saveTradeSettings({ tradeTol: Number(input.value) });
      else if (key === 'tradeLastGain')
        void saveTradeSettings({ tradeLastGain: Number(input.value) });
      else void saveTradeSettings({ tradeRefreshMin: Number(input.value) });
    });
    return input;
  };
  const check = (key: 'tradeSameRarity' | 'tradeUseLast', label: string) => {
    const input = h('input', { type: 'checkbox' }) as HTMLInputElement;
    input.checked = tradeSettings[key];
    input.addEventListener('change', () => {
      if (key === 'tradeSameRarity') void saveTradeSettings({ tradeSameRarity: input.checked });
      else void saveTradeSettings({ tradeUseLast: input.checked });
    });
    return h('label', { class: 'inline' }, input, label);
  };
  fill(
    form,
    field('Écart de valeur accepté (%)', number('tradeTol', 0, 100)),
    field('Gain minimal pour ma dernière copie (%)', number('tradeLastGain', 0, 500)),
    field(
      'Actualisation automatique du comptoir (minutes, 0 = jamais)',
      number('tradeRefreshMin', 0, 60),
    ),
    check('tradeSameRarity', 'Exiger une rareté reçue au moins égale'),
    check('tradeUseLast', 'Autoriser à donner ma dernière copie'),
  );
}

async function saveTradeSettings(patch: Partial<TradeSettings>): Promise<void> {
  tradeSettings = normalizeTradeSettings({ ...tradeSettings, ...patch });
  await tradeSettingsItem.setValue(tradeSettings);
  syncTradeAutoRefresh();
  setTradeStatus('Réglages enregistrés. Recharge les échanges pour réévaluer les offres.');
}

async function acceptDeal(offer: TradeOffer, deal: TradeDeal): Promise<void> {
  if (acceptingId) return;
  acceptingId = offer.id;
  const giveName = meta.get(deal.giveId)?.name ?? `Carte #${deal.giveId}`;
  const receivedName = meta.get(offer.characterId)?.name ?? `Carte #${offer.characterId}`;
  setTradeStatus(`Acceptation de l’échange contre ${giveName}…`);
  try {
    await gameActions.acceptTrade(api, offer.id, deal.giveId);
    if (trades) {
      trades = {
        ...trades,
        offers: trades.offers.filter((item) => item.id !== offer.id),
        deals: trades.deals.filter((item) => item.offerId !== offer.id),
      };
      renderTrades();
    }
    setTradeStatus(
      `Échange accepté : ${receivedName} a rejoint ta collection. Actualisation de la liste…`,
    );
    const refreshed = await loadTrades({ reportStatus: false });
    if (refreshed) {
      setTradeStatus(`Échange accepté : ${receivedName} a rejoint ta collection.`);
    } else {
      setTradeStatus(
        `Échange accepté : ${receivedName} a rejoint ta collection. ` +
          'La liste n’a pas pu être actualisée ; tu peux réessayer avec « Réessayer la liste ».',
      );
      setTradesRetry(true);
    }
  } catch (error) {
    setTradeStatus(explain(error), true);
  } finally {
    acceptingId = null;
    syncTradeAutoRefresh();
  }
}

function tradeCard(offer: TradeOffer, deal: TradeDeal | undefined): HTMLElement {
  const left = meta.get(offer.characterId);
  const image = imageUrl(left?.image ?? `/cards/sm/${offer.characterId}.webp`);
  const wish = wishes.has(offer.characterId);
  const wants = offer.wantIds.map((id) => {
    const card = meta.get(id);
    const count = trades?.cards.owned.get(id) ?? 0;
    const blocked = trades?.cards.blocked.has(id) ?? false;
    return h(
      'span',
      { class: `want${deal?.giveId === id ? ' best' : ''}${blocked ? ' blocked' : ''}` },
      `${card?.name ?? `Carte #${id}`} · ×${fmt(count)}${blocked ? ' 🔒' : ''}`,
    );
  });
  const detail = deal
    ? h(
        'p',
        {},
        `Donner ${meta.get(deal.giveId)?.name ?? `Carte #${deal.giveId}`} (×${fmt(deal.n)}) · `,
        `reçois ◆ ${fmt(deal.get)} · donnes ◆ ${fmt(deal.give)}`,
        deal.up ? ' · rareté supérieure' : '',
      )
    : h('p', { class: 'muted' }, trades ? noDealReason(trades, offer) : '');
  const gain = deal ? `${deal.gain >= 0 ? '+' : ''}${fmt(deal.gain)} ◆` : '—';
  const accept = deal
    ? armable(
        'Accepter l’échange',
        `Confirmer : donner ${meta.get(deal.giveId)?.name ?? `Carte #${deal.giveId}`}`,
        () => acceptDeal(offer, deal),
      )
    : null;
  if (accept) {
    accept.className = 'accept';
    accept.title = `Accepter l’offre de ${offer.userPseudo ?? 'cet échange'} en donnant ${meta.get(deal?.giveId ?? 0)?.name ?? `la carte #${deal?.giveId}`}${deal?.n === 1 ? ' (ta dernière copie)' : ''}.`;
  }
  return h(
    'article',
    { class: `offer${deal ? ' good' : ''}` },
    h(
      'div',
      { class: 'offer-head' },
      image && h('img', { src: image, alt: '', loading: 'lazy' }),
      h(
        'div',
        { class: 'grow' },
        h('b', {}, left?.name ?? `Carte #${offer.characterId}`),
        h('small', {}, [left?.rarity, left?.series].filter(Boolean).join(' · ')),
        wish && h('span', { class: 'wish' }, '★ envie'),
      ),
      h('div', { class: 'gain' }, gain),
    ),
    h(
      'div',
      { class: 'offer-body' },
      h('small', {}, 'Contre'),
      h('div', { class: 'wants' }, ...wants),
      detail,
    ),
    h(
      'div',
      { class: 'actions' },
      accept,
      h(
        'a',
        { href: 'https://kyara.games/marche?onglet=echanges', target: '_blank', rel: 'noreferrer' },
        'Voir les échanges sur Kyara',
      ),
    ),
  );
}

function renderTrades(): void {
  const box = $('trades-list');
  if (!trades) {
    fill(
      box,
      h('p', { class: 'muted' }, 'Clique sur « Charger les échanges » pour lire le comptoir.'),
    );
    return;
  }
  const onlyGood = ($('trades-good-only') as HTMLInputElement | null)?.checked ?? false;
  const deals = new Map(trades.deals.map((deal) => [deal.offerId, deal]));
  const stamp = (value: string | null) => {
    const parsed = value ? Date.parse(value) : 0;
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const offers = [...trades.offers]
    .filter((offer) => !onlyGood || deals.has(offer.id))
    .sort(
      (a, b) =>
        Number(deals.has(b.id)) - Number(deals.has(a.id)) ||
        stamp(b.createdAt) - stamp(a.createdAt),
    );
  if (!offers.length) {
    fill(
      box,
      h(
        'p',
        { class: 'muted' },
        onlyGood ? 'Aucun bon échange avec ces réglages.' : 'Aucune offre ouverte.',
      ),
    );
    return;
  }
  fill(box, ...offers.map((offer) => tradeCard(offer, deals.get(offer.id))));
}

function wishCard(id: number): HTMLElement {
  const card = meta.get(id);
  const image = imageUrl(card?.image ?? `/cards/sm/${id}.webp`);
  const owned = trades?.cards.owned.get(id);
  return h(
    'div',
    { class: 'wish-item' },
    image && h('img', { src: image, alt: '', loading: 'lazy' }),
    h(
      'div',
      { class: 'grow' },
      h('b', {}, card?.name ?? `Carte #${id}`),
      h('small', {}, [card?.rarity, card?.series].filter(Boolean).join(' · ')),
      owned !== undefined && h('small', {}, `possédée ×${fmt(owned)}`),
    ),
  );
}

function renderWishResults(): void {
  const input = $('wish-search') as HTMLInputElement;
  const box = $('wish-results');
  const query = input.value.trim().toLowerCase();
  if (query.length < 2) {
    box.replaceChildren();
    return;
  }
  const rows = [...meta.entries()]
    .filter(([id, card]) => !wishes.has(id) && (card.name ?? '').toLowerCase().includes(query))
    .sort((a, b) => (a[1].name ?? '').localeCompare(b[1].name ?? '', 'fr'))
    .slice(0, 20);
  if (!rows.length) {
    fill(box, h('p', { class: 'muted' }, 'Aucune carte du catalogue ne correspond.'));
    return;
  }
  fill(
    box,
    ...rows.map(([id, card]) =>
      h(
        'div',
        { class: 'wish-result' },
        h(
          'span',
          { class: 'grow' },
          card.name ?? `Carte #${id}`,
          h('small', {}, [card.rarity, card.series].filter(Boolean).join(' · ')),
        ),
        h('button', { type: 'button', onclick: () => void addWishFromCatalog(id) }, 'Ajouter'),
      ),
    ),
  );
}

function renderWishes(): void {
  const box = $('wish-list');
  const ids = [...wishes].sort((a, b) =>
    (meta.get(a)?.name ?? '').localeCompare(meta.get(b)?.name ?? '', 'fr'),
  );
  if (!ids.length) {
    fill(
      box,
      h(
        'p',
        { class: 'muted' },
        'Ta liste d’envies est vide. Cherche une carte ci-dessus pour l’ajouter.',
      ),
    );
  } else {
    fill(box, ...ids.map(wishCard));
  }
  renderWishResults();
}

async function addWishFromCatalog(id: number): Promise<void> {
  if (wishesBusy) return;
  wishesBusy = true;
  setWishStatus('Ajout à tes envies…');
  try {
    wishes = new Set(await gameActions.addWish(api, id));
    renderWishes();
    setWishStatus(`${meta.get(id)?.name ?? `Carte #${id}`} ajoutée à tes envies.`);
  } catch (error) {
    setWishStatus(explain(error), true);
  } finally {
    wishesBusy = false;
  }
}

function tradeRefreshIntervalMs(): number {
  const minutes = tradeSettings?.tradeRefreshMin ?? 5;
  return minutes > 0 ? minutes * 60_000 : 0;
}

function renderTradeRefresh(): void {
  const element = document.getElementById('trades-refresh');
  if (!element) return;
  const minutes = tradeSettings?.tradeRefreshMin ?? 5;
  if (minutes <= 0) {
    element.textContent = 'Actualisation automatique désactivée.';
    return;
  }
  const state = tradeAutoRefresh?.state();
  const last = Math.max(state?.lastSuccessAt ?? 0, tradesLoadedAt ?? 0) || null;
  if (!last) {
    element.textContent =
      `Actualisation automatique toutes les ${fmt(minutes)} min · ` +
      'en attente du premier chargement.';
    return;
  }
  const time = new Date(last).toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
  });
  const paused = currentTab !== 'trades' || document.hidden;
  element.textContent =
    `Actualisation automatique toutes les ${fmt(minutes)} min · dernière à ${time}` +
    (paused ? ' · en pause' : '');
}

function syncTradeAutoRefresh(): void {
  if (!tradeAutoRefresh) return;
  const interval = tradeRefreshIntervalMs();
  tradeAutoRefresh.setInterval(interval);
  if (!interval || !trades || currentTab !== 'trades' || document.hidden) {
    // Pause plutôt qu'arrêt : un passage rapide sur un autre onglet ne doit pas
    // repousser le prochain contrôle du comptoir.
    tradeAutoRefresh.pause();
  } else {
    tradeAutoRefresh.start();
  }
  renderTradeRefresh();
}

function maybeRefreshTrades(): void {
  if (!tradeAutoRefresh || !trades || !tradesLoadedAt) return;
  const interval = tradeRefreshIntervalMs();
  if (!interval || Date.now() - tradesLoadedAt < interval) return;
  void tradeAutoRefresh.refreshNow();
}

async function loadTrades(
  options: { reportStatus?: boolean; automatic?: boolean } = {},
): Promise<boolean> {
  if (tradesBusy) return false;
  tradesBusy = true;
  const reportStatus = options.reportStatus !== false;
  const button = $('load-trades');
  button.setAttribute('disabled', '');
  setTradesRetry(false);
  if (reportStatus) setTradeStatus('Lecture des échanges…');
  try {
    const catalog = await getCatalog(api);
    rememberCatalog(catalog);
    tradeSettings = await getTradeSettings();
    if (!options.automatic) renderTradeSettings();
    try {
      wishes = new Set(await loadWishlist(api));
      wishesLoaded = true;
      const add = $('wish-add');
      if (add) add.hidden = false;
    } catch (error) {
      if (error instanceof AuthError) throw error;
      wishes = new Set();
    }
    trades = await loadTradeBoard(api, tradeSettings, catalog);
    await recordTradeAlerts(trades, [...wishes], catalog);
    tradesLoadedAt = Date.now();
    renderTrades();
    renderTradeRefresh();
    const summary =
      `${fmt(trades.offers.length)} offre(s) ouverte(s) · ` +
      `${fmt(trades.deals.length)} bon(s) échange(s) · ${fmt(wishes.size)} envie(s)`;
    if (reportStatus) setTradeStatus(summary);
    else if (options.automatic) setTradeStatus(`Actualisé automatiquement · ${summary}`);
    return true;
  } catch (error) {
    if (reportStatus || options.automatic) setTradeStatus(explain(error), true);
    setTradesRetry(true);
    return false;
  } finally {
    tradesBusy = false;
    button.removeAttribute('disabled');
    syncTradeAutoRefresh();
    renderTradeRefresh();
  }
}

async function loadWishes(): Promise<void> {
  if (wishesBusy) return;
  wishesBusy = true;
  const button = $('load-wishes');
  button.setAttribute('disabled', '');
  setWishStatus('Lecture de tes envies…');
  try {
    const catalog = await getCatalog(api);
    rememberCatalog(catalog);
    wishes = new Set(await loadWishlist(api, undefined, { force: true }));
    wishesLoaded = true;
    const add = $('wish-add');
    if (add) add.hidden = false;
    renderWishes();
    setWishStatus(`${fmt(wishes.size)} carte(s) dans ta liste d’envies.`);
  } catch (error) {
    setWishStatus(explain(error), true);
  } finally {
    wishesBusy = false;
    button.removeAttribute('disabled');
  }
}

function openTrades(): void {
  if (!trades && !tradesBusy) void loadTrades();
  else renderTrades();
}

function openWishes(): void {
  if (!wishesLoaded && !wishesBusy) {
    void loadWishes();
    return;
  }
  if (wishesLoaded) {
    const add = $('wish-add');
    if (add) add.hidden = false;
  }
  renderWishes();
}

function renderSettings(): void {
  const form = $('settings');
  const field = (label: string, control: HTMLElement) => h('label', {}, label, control);
  const select = (key: keyof SellSettings, options: [string, string][]) => {
    const el = h('select') as HTMLSelectElement;
    for (const [value, text] of options) el.append(h('option', { value }, text));
    el.value = String(settings[key]);
    el.addEventListener('change', () => void save({ [key]: el.value }));
    return el;
  };
  const number = (key: keyof SellSettings, min: number, max: number) => {
    const el = h('input', {
      type: 'number',
      min: String(min),
      max: String(max),
      value: String(settings[key]),
    }) as HTMLInputElement;
    el.addEventListener('change', () => void save({ [key]: Number(el.value) }));
    return el;
  };
  const text = h('input', {
    type: 'text',
    value: settings.exclude,
    placeholder: '12, 345, 6789',
  }) as HTMLInputElement;
  text.addEventListener('change', () => void save({ exclude: text.value }));
  fill(
    form,
    field(
      'Prix',
      select('pricePreset', [
        ...Object.entries(PRESETS).map(
          ([key, p]) => [key, `${p.label} (${p.hint})`] as [string, string],
        ),
      ]),
    ),
    field('Exemplaires à garder', number('keep', 0, 20)),
    field(
      'Durée de l’annonce',
      select('durationHours', [
        ['12', '12 h'],
        ['24', '24 h'],
        ['48', '48 h'],
      ]),
    ),
    field('Prix minimum (◆)', number('minPrice', 1, 1_000_000)),
    field('Ventes minimales sur 30 j', number('minSales', 0, 1000)),
    field('Emplacements max', number('maxSlots', 1, 100)),
    field('Vente auto : minutes entre deux passages', number('intervalMin', 5, 120)),
    field(
      'Tri',
      select('order', [
        ['priceDesc', 'Prix décroissant'],
        ['priceAsc', 'Prix croissant'],
        ['oldest', 'Plus anciens'],
        ['newest', 'Plus récents'],
      ]),
    ),
    field('Ne jamais vendre (identifiants)', text),
  );
}

async function save(patch: Record<string, unknown>): Promise<void> {
  settings = normalizeSellSettings({ ...settings, ...patch });
  await sellSettingsItem.setValue(settings);
  for (const c of list) applyPrice(c, settings);
  sortCandidates(list, settings);
  renderSlots();
  renderTable();
}

async function init(): Promise<void> {
  settings = await getSellSettings();
  tradeSettings = await getTradeSettings();
  renderSettings();
  renderTradeSettings();
  tradeAutoRefresh = new TradeRefresh({
    intervalMs: tradeRefreshIntervalMs(),
    refresh: () => loadTrades({ reportStatus: false, automatic: true }),
    isActive: () => currentTab === 'trades' && !document.hidden && !acceptingId,
    onState: () => renderTradeRefresh(),
  });
  syncTradeAutoRefresh();
  renderTrades();
  renderWishes();
  renderSlots();
  renderActive();
  const changes = await shapeChangesItem.getValue();
  if (Object.keys(changes).length) {
    const names = Object.values(changes)
      .map((c) => c.label)
      .join(', ');
    setStatus(`Kyara a changé le format de : ${names}. Les ventes sont en pause.`, true);
    $('status').append(
      ' ',
      armable('Réessayer', 'Confirmer', async () => {
        await clearShapeChanges();
        setStatus('');
      }),
    );
  } else if (!(await sessionItem.getValue())) {
    setStatus('Ouvre kyara.games et connecte-toi, garde cet onglet ouvert.', true);
  }
  // Lien direct vers le comptoir.
  if (location.hash.startsWith('#trade')) showTab('trades');
}

$('tab-sell').addEventListener('click', () => showTab('sell'));
$('tab-trades').addEventListener('click', () => showTab('trades'));
$('tab-wishes').addEventListener('click', () => showTab('wishes'));
$('tab-activity').addEventListener('click', () => showTab('activity'));
$('load-activity').addEventListener('click', () => void refreshMarketActivity());
activityItem.watch(scheduleActivityRender);
salesItem.watch(scheduleActivityRender);
$('load-trades').addEventListener('click', () => void loadTrades());
$('trades-retry').addEventListener('click', () => void loadTrades());
$('trades-good-only').addEventListener('change', renderTrades);
document.addEventListener('visibilitychange', () => {
  if (currentTab !== 'trades') return;
  syncTradeAutoRefresh();
  if (!document.hidden) maybeRefreshTrades();
});
$('load-wishes').addEventListener('click', () => void loadWishes());
$('wish-search').addEventListener('input', renderWishResults);
$('load').addEventListener('click', () => void load());
$('estimate').addEventListener('click', () => void estimate());
$('fill').addEventListener('click', () => void fillSlots());
void init();
