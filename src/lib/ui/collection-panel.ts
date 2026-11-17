import type { ApiClient } from '../api';
import { fmt, h } from '../dom';
import {
  recyclable,
  recyclableChakra,
  scanDuplicates,
  type DuplicateRow,
  type DuplicateScanResult,
} from '../doublons/advisor-scan';
import { scanDeals, type DealScan, type DealScanOptions } from '../doublons/deals';
import { recycleCard } from '../doublons/market';
import { getSellSettings, type SellSettings } from '../doublons/settings';
import { sellNext } from '../doublons/sell';
import type { Candidate } from '../doublons/candidates';
import {
  duplicateCacheItem,
  duplicateCachePayload,
  normalizeDuplicateCache,
} from '../doublons/duplicate-cache';
import type { MarketConfig } from '../doublons/advisor';
import collectionCss from './collection-panel.css?inline';
import {
  closeOtherSecondaryPanels,
  registerSecondaryPanel,
  unregisterSecondaryPanel,
} from './secondary-panel';

/**
 * Panneau « Mes doublons », à gauche du panneau principal : il reprend la liste de Kyara
 * Doublons (une ligne par carte en double) et l'analyse complète de Kyara Helper, avec le
 * recyclage des seules cartes conseillées « Recycler » (un exemplaire conservé).
 */

export type PanelApi = Pick<ApiClient, 'request'>;

export interface CollectionPanel {
  host: HTMLElement;
  root: ShadowRoot;
  close: () => void;
  /** Relance l'analyse complète. */
  restart: () => void;
}

interface Entry {
  row: DuplicateRow;
  el: HTMLElement;
  button: HTMLButtonElement;
  sell: HTMLButtonElement | null;
  order: HTMLButtonElement | null;
  verdict: HTMLElement;
  done: boolean;
}

type Filter = 'all' | 'vendre' | 'ordre' | 'recycler' | 'error';
const VERDICT_LABEL: Record<string, string> = {
  vendre: 'Vendre',
  ordre: 'Vendre à l’ordre',
  recycler: 'Recycler',
};
const RECYCLE_PAUSE_MS = 450;

/** Carte synthétique pour vendre à un prix choisi, sans repasser par l'estimation. */
function sellCandidate(row: DuplicateRow, price: number): Candidate {
  return {
    id: row.id,
    qty: 1,
    locked: 0,
    sellable: 1,
    firstAt: null,
    blocked: null,
    status: '',
    prices: null,
    pricedAt: null,
    price,
    priceWhy: '',
    manual: true,
    name: row.name,
    image: null,
    rarity: row.rarity,
    series: null,
    checked: false,
  };
}

let current: CollectionPanel | null = null;

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

function thumb(id: number): HTMLElement {
  return h('img', {
    class: 'kc-thumb',
    src: `/cards/sm/${id}.webp`,
    alt: '',
    width: '40',
    height: '56',
  });
}

function detail(row: DuplicateRow): string {
  const advice = row.advice;
  if (!advice) return row.error ?? 'Analyse impossible';
  return [
    advice.ref !== null ? `médiane ${fmt(advice.ref)} ◆` : 'pas de médiane',
    advice.lowestAsk !== null ? `concurrence ${fmt(advice.lowestAsk)} ◆` : 'sans concurrence',
    advice.bestBid !== undefined ? `ordre ${fmt(advice.bestBid)} ◆` : 'aucun ordre',
    advice.price !== undefined ? `prix ${fmt(advice.price)} ◆` : '',
    advice.net !== undefined ? `net ${fmt(advice.net)} ◆` : '',
    `recyclage ${fmt(advice.recycle)} ◆`,
  ]
    .filter(Boolean)
    .join(' · ');
}

export function openCollectionPanel(api: PanelApi): CollectionPanel {
  if (current) {
    closeOtherSecondaryPanels('collection');
    current.restart();
    return current;
  }
  closeOtherSecondaryPanels('collection');
  if (document.getElementById('kyara-plus-collection')) {
    document.getElementById('kyara-plus-collection')?.remove();
  }

  const host = h('div', { id: 'kyara-plus-collection' });
  const root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = collectionCss;

  const status = h('p', { class: 'kc-status', role: 'status' }, 'Lecture de ta collection…');
  const count = h('small', {}, '');
  const search = h('input', {
    type: 'search',
    class: 'kc-search',
    placeholder: 'Filtrer par nom…',
    'aria-label': 'Filtrer les doublons par nom',
  }) as HTMLInputElement;
  const bulk = h(
    'button',
    { type: 'button', class: 'kc-button is-danger', disabled: true },
    'Tout recycler',
  ) as HTMLButtonElement;
  const bulkOrders = h(
    'button',
    { type: 'button', class: 'kc-button is-sell', disabled: true },
    'Vendre aux ordres',
  ) as HTMLButtonElement;
  const chips = h('div', { class: 'kc-chips', role: 'tablist' });
  const rowsHost = h('div', { class: 'kc-rows' });
  const confirm = h('div', { class: 'kc-confirm', hidden: true });
  const dealsHost = h('div', {});
  const dealsButton = h(
    'button',
    { type: 'button', class: 'kc-button' },
    'Voir les occasions du marché',
  ) as HTMLButtonElement;

  const closeButton = h(
    'button',
    { type: 'button', class: 'kc-close', 'aria-label': 'Fermer le panneau des doublons' },
    '×',
  ) as HTMLButtonElement;

  root.append(
    style,
    h(
      'aside',
      { class: 'kc-panel', role: 'dialog', 'aria-label': 'Mes doublons' },
      h(
        'header',
        { class: 'kc-head' },
        h('div', {}, h('b', {}, 'Mes doublons'), count),
        closeButton,
      ),
      status,
      h('div', { class: 'kc-tools' }, search, bulk, bulkOrders),
      confirm,
      chips,
      rowsHost,
      dealsHost,
      h(
        'footer',
        { class: 'kc-foot' },
        'Analyse complète de la collection : toutes les cartes en double, hors cartes protégées. ' +
          'Un exemplaire de chaque carte est toujours conservé.',
      ),
    ),
  );
  document.body.append(host);

  const entries: Entry[] = [];
  const byId = new Map<number, Entry>();
  const done = new Set<number>();
  let cacheLoaded = false;
  let filter: Filter = 'all';
  let result: DuplicateScanResult | null = null;
  let scan: AbortController | null = null;
  let deals: DealScan | null = null;
  let closed = false;

  const matches = (entry: Entry): boolean => {
    const query = search.value.trim().toLowerCase();
    if (query && !entry.row.name.toLowerCase().includes(query)) return false;
    if (filter === 'all') return true;
    if (filter === 'error') return entry.row.error !== null;
    return entry.row.advice?.verdict === filter;
  };

  const paintFilters = (): void => {
    for (const entry of entries) entry.el.hidden = !matches(entry);
  };

  const counts = (): Record<Filter, number> => {
    const base: Record<Filter, number> = { all: entries.length, vendre: 0, ordre: 0, recycler: 0, error: 0 };
    for (const entry of entries) {
      if (entry.row.error) base.error += 1;
      else if (entry.row.advice?.verdict === 'vendre') base.vendre += 1;
      else if (entry.row.advice?.verdict === 'ordre') base.ordre += 1;
      else if (entry.row.advice?.verdict === 'recycler') base.recycler += 1;
    }
    return base;
  };

  const paintChips = (): void => {
    const totals = counts();
    const LABELS: Record<Filter, string> = {
      all: 'Tout',
      vendre: 'Vendre',
      ordre: 'À l’ordre',
      recycler: 'Recycler',
      error: 'Erreurs',
    };
    chips.replaceChildren(
      ...(Object.keys(LABELS) as Filter[]).map((key) =>
        h(
          'button',
          {
            type: 'button',
            class: `kc-chip${filter === key ? ' on' : ''}`,
            role: 'tab',
            'aria-selected': filter === key ? 'true' : 'false',
            onclick: () => {
              filter = key;
              paintChips();
              paintFilters();
            },
          },
          LABELS[key],
          h('em', {}, fmt(totals[key])),
        ),
      ),
    );
  };

  const pendingRecycle = (): Entry[] =>
    entries.filter((entry) => !entry.done && recyclable(entry.row) > 0);

  /** Seules les cartes dont le conseil est explicitement « À l'ordre ». */
  const pendingOrders = (): Entry[] =>
    entries.filter(
      (entry) =>
        !entry.done &&
        entry.row.advice?.verdict === 'ordre' &&
        (entry.row.advice.bestBid ?? 0) > 0,
    );

  const paintBulk = (): void => {
    const list = pendingRecycle();
    const total = recyclableChakra(list.map((entry) => entry.row));
    bulk.disabled = list.length === 0;
    bulk.textContent = list.length
      ? `Tout recycler · ${fmt(list.length)} carte(s) · +${fmt(total)} ◆`
      : 'Tout recycler';
    const orders = pendingOrders();
    const proceeds = orders.reduce((sum, entry) => sum + (entry.row.advice?.bestBid ?? 0), 0);
    bulkOrders.disabled = orders.length === 0;
    bulkOrders.textContent = orders.length
      ? `Vendre aux ordres · ${fmt(orders.length)} carte(s) · +${fmt(proceeds)} ◆`
      : 'Vendre aux ordres';
  };

  const paintSummary = (): void => {
    count.textContent = result
      ? ` · ${fmt(result.total)} doublon(s) analysé(s)${result.errors ? ` · ${fmt(result.errors)} erreur(s)` : ''}`
      : '';
    paintChips();
    paintBulk();
  };

  /** Une carte vendue ou recyclée quitte la liste : elle ne revient pas au scan suivant. */
  const markDone = (entry: Entry): void => {
    entry.done = true;
    done.add(entry.row.id);
    byId.delete(entry.row.id);
    const index = entries.indexOf(entry);
    if (index >= 0) entries.splice(index, 1);
    entry.el.remove();
    paintBulk();
    paintFilters();
    persist();
  };

  let settings: SellSettings | null = null;
  const sellSettings = async (): Promise<SellSettings> => {
    settings ??= await getSellSettings();
    return settings;
  };

  /** Vend un exemplaire au prix demandé : prix conseillé ou prix de l'ordre. */
  const sellAt = async (entry: Entry, price: number, label: string): Promise<boolean> => {
    const buttons = [entry.sell, entry.order].filter(
      (button): button is HTMLButtonElement => button !== null,
    );
    for (const button of buttons) button.disabled = true;
    try {
      const placed = await sellNext(
        api,
        await sellSettings(),
        [sellCandidate(entry.row, price)],
        1,
        { gapMs: 0 },
      );
      if (placed < 1) {
        for (const button of buttons) button.disabled = false;
        status.textContent = `${entry.row.name} : Kyara a refusé la vente à ${fmt(price)} ◆.`;
        return false;
      }
      markDone(entry);
      status.textContent = `${entry.row.name} vendu à ${fmt(price)} ◆ (${label}).`;
      return true;
    } catch (error) {
      for (const button of buttons) button.disabled = false;
      status.textContent = `${entry.row.name} : ${
        error instanceof Error ? error.message : String(error)
      }`;
      return false;
    }
  };

  const recycleOne = async (entry: Entry): Promise<void> => {
    const qty = recyclable(entry.row);
    if (!qty || entry.done) return;
    entry.button.disabled = true;
    const outcome = await recycleCard(api, entry.row.id, qty);
    if (!outcome.ok) {
      entry.button.disabled = false;
      status.textContent = `${entry.row.name} : ${outcome.message || 'recyclage refusé'}`;
      return;
    }
    markDone(entry);
    const gain = qty * (entry.row.advice?.recycle ?? 0);
    status.textContent = `${entry.row.name} : ${fmt(qty)} recyclée(s), +${fmt(gain)} ◆.`;
  };

  /** Bouton armé par deux vrais clics, comme les écritures du panneau principal. */
  const guarded = (
    button: HTMLButtonElement,
    armedLabel: string,
    onConfirm: () => void | Promise<void>,
  ): void => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const reset = (): void => {
      clearTimeout(timer);
      button.classList.remove('is-armed');
      button.textContent = armedLabel;
    };
    button.addEventListener('click', (event) => {
      if (!event.isTrusted || button.disabled) return;
      if (!button.classList.contains('is-armed')) {
        button.classList.add('is-armed');
        button.textContent = 'Confirmer';
        timer = setTimeout(reset, 4_000);
        return;
      }
      reset();
      void onConfirm();
    });
  };

  /** Construit une ligne fraîche, sans encore l'attacher à la liste. */
  const createRow = (row: DuplicateRow): Entry => {
    const qty = recyclable(row);
    const button = h(
      'button',
      { type: 'button', class: 'kc-button', disabled: qty === 0 },
      qty > 0 ? `Recycler ×${fmt(qty)}` : 'Rien à recycler',
    ) as HTMLButtonElement;
    const verdict = h(
      'span',
      {
        class: `kc-verdict${row.error ? ' is-error' : row.advice ? ` is-${row.advice.verdict}` : ''}`,
      },
      row.error ? 'Erreur' : (VERDICT_LABEL[row.advice?.verdict ?? ''] ?? '—'),
    );
    const entry = { row, button, sell: null, order: null, verdict, done: false } as unknown as Entry;
    const advice = row.advice;
    const askPrice = advice?.verdict === 'vendre' ? (advice.price ?? null) : null;
    let sell: HTMLButtonElement | null = null;
    if (askPrice && askPrice > 0) {
      sell = h(
        'button',
        { type: 'button', class: 'kc-button is-sell' },
        `Vendre ${fmt(askPrice)} ◆`,
      ) as HTMLButtonElement;
      guarded(sell, `Vendre ${fmt(askPrice)} ◆`, () => {
        void sellAt(entry, askPrice, 'prix conseillé');
      });
    }
    const bid = advice?.bestBid ?? 0;
    let order: HTMLButtonElement | null = null;
    if (advice?.verdict === 'ordre' && bid > 0) {
      order = h(
        'button',
        { type: 'button', class: 'kc-button is-sell' },
        `Vendre à l’ordre ${fmt(bid)} ◆`,
      ) as HTMLButtonElement;
      guarded(order, `Vendre à l’ordre ${fmt(bid)} ◆`, () => {
        void sellAt(entry, bid, 'prix de l’ordre');
      });
    }
    const el = h(
      'div',
      { class: 'kc-row' },
      thumb(row.id),
      h(
        'div',
        { class: 'kc-main' },
        h('b', {}, row.name),
        h(
          'small',
          {},
          `${row.rarity || '?'} · ${fmt(row.copies)} en trop` +
            (row.listed ? ` · ${fmt(row.listed)} en vente` : '') +
            (row.spare ? ` · ${fmt(row.spare)} libre(s)` : ''),
        ),
        h('small', {}, detail(row)),
      ),
      h(
        'div',
        { class: 'kc-side' },
        verdict,
        h('div', { class: 'kc-actions' }, sell, order),
        button,
      ),
    );
    entry.el = el;
    entry.sell = sell;
    entry.order = order;
    guarded(button, qty > 0 ? `Recycler ×${fmt(qty)}` : 'Rien à recycler', () =>
      recycleOne(entry),
    );
    if (row.error) {
      verdict.className = 'kc-verdict is-error';
    }
    if (!matches(entry)) el.hidden = true;
    return entry;
  };

  /**
   * Ajoute une nouvelle carte ou remplace la ligne existante : une actualisation en
   * arrière-plan met à jour prix, ordre et verdict sans vider le panneau.
   */
  const addRow = (row: DuplicateRow): Entry | null => {
    // Une carte déjà vendue ou recyclée ne réapparaît pas dans la liste.
    if (done.has(row.id)) return null;
    const existing = byId.get(row.id);
    if (existing?.done) return existing;
    const fresh = createRow(row);
    if (existing) {
      const index = entries.indexOf(existing);
      if (index >= 0) entries[index] = fresh;
      existing.el.replaceWith(fresh.el);
    } else {
      entries.push(fresh);
      rowsHost.append(fresh.el);
    }
    byId.set(row.id, fresh);
    return fresh;
  };

  const persist = (): void => {
    const rows = entries.map((entry) => ({
      row: entry.row,
      done: entry.done,
      doneLabel: entry.done ? (entry.button.textContent ?? '') : '',
    }));
    void duplicateCacheItem
      .setValue(duplicateCachePayload(rows))
      .catch(() => undefined);
  };

  const bulkConfirm = h(
    'button',
    { type: 'button', class: 'kc-button is-danger' },
    'Recycler',
  ) as HTMLButtonElement;
  const bulkCancel = h('button', { type: 'button', class: 'kc-button' }, 'Annuler');
  confirm.append(
    h('b', {}, 'Recycler les doublons conseillés'),
    h('small', {}, 'Seules les cartes conseillées « Recycler » partent, un exemplaire est conservé.'),
    h('div', {}, bulkConfirm, bulkCancel),
  );

  const runBulk = async (): Promise<void> => {
    confirm.hidden = true;
    const list = pendingRecycle();
    if (!list.length) return;
    bulk.disabled = true;
    let reclaimed = 0;
    let okCount = 0;
    let failures = 0;
    for (const [index, entry] of list.entries()) {
      if (closed) return;
      const qty = recyclable(entry.row);
      const outcome = await recycleCard(api, entry.row.id, qty);
      if (outcome.ok) {
        okCount += 1;
        failures = 0;
        reclaimed += qty * (entry.row.advice?.recycle ?? 0);
        markDone(entry);
      } else {
        failures += 1;
        status.textContent = `${entry.row.name} : ${outcome.message || 'recyclage refusé'}`;
        if (outcome.code === 'auth' || outcome.status === 401 || outcome.status === 429 || failures >= 3) {
          status.textContent += ' · série arrêtée.';
          break;
        }
      }
      status.textContent = `Recyclage ${fmt(index + 1)} / ${fmt(list.length)} · +${fmt(reclaimed)} ◆`;
      await sleep(RECYCLE_PAUSE_MS);
    }
    status.textContent = `Recyclage terminé : ${fmt(okCount)} carte(s), +${fmt(reclaimed)} ◆.`;
    paintBulk();
  };

  bulk.addEventListener('click', (event) => {
    if (!event.isTrusted || bulk.disabled) return;
    const list = pendingRecycle();
    if (!list.length) return;
    const total = recyclableChakra(list.map((entry) => entry.row));
    bulkConfirm.textContent = `Recycler ${fmt(list.length)} carte(s) · +${fmt(total)} ◆`;
    confirm.hidden = false;
  });
  bulkCancel.addEventListener('click', () => {
    confirm.hidden = true;
  });
  let bulkArmed = false;
  let bulkTimer: ReturnType<typeof setTimeout> | undefined;
  bulkConfirm.addEventListener('click', (event) => {
    if (!event.isTrusted) return;
    if (!bulkArmed) {
      bulkArmed = true;
      bulkConfirm.textContent = 'Confirmer le recyclage';
      bulkTimer = setTimeout(() => {
        bulkArmed = false;
      }, 4_000);
      return;
    }
    clearTimeout(bulkTimer);
    bulkArmed = false;
    void runBulk();
  });

  const runOrders = async (): Promise<void> => {
    const list = pendingOrders();
    if (!list.length) return;
    bulkOrders.disabled = true;
    let sold = 0;
    let proceeds = 0;
    let failures = 0;
    for (const [index, entry] of list.entries()) {
      if (closed) return;
      const price = entry.row.advice?.bestBid ?? 0;
      if (!price) continue;
      if (await sellAt(entry, price, 'ordre d’achat')) {
        sold += 1;
        failures = 0;
        proceeds += price;
      } else {
        failures += 1;
        if (failures >= 3) {
          status.textContent += ' · série arrêtée.';
          break;
        }
      }
      status.textContent = `Vente aux ordres ${fmt(index + 1)} / ${fmt(list.length)} · +${fmt(proceeds)} ◆`;
      await sleep(RECYCLE_PAUSE_MS);
    }
    status.textContent = `Vente aux ordres terminée : ${fmt(sold)} carte(s), +${fmt(proceeds)} ◆.`;
    paintBulk();
  };

  let ordersArmed = false;
  let ordersTimer: ReturnType<typeof setTimeout> | undefined;
  bulkOrders.addEventListener('click', (event) => {
    if (!event.isTrusted || bulkOrders.disabled) return;
    if (!ordersArmed) {
      ordersArmed = true;
      bulkOrders.classList.add('is-armed');
      bulkOrders.textContent = 'Confirmer la vente aux ordres';
      ordersTimer = setTimeout(() => {
        ordersArmed = false;
        bulkOrders.classList.remove('is-armed');
        paintBulk();
      }, 4_000);
      return;
    }
    clearTimeout(ordersTimer);
    ordersArmed = false;
    bulkOrders.classList.remove('is-armed');
    void runOrders();
  });

  search.addEventListener('input', paintFilters);

  const loadDeals = async (config: MarketConfig): Promise<void> => {
    dealsButton.disabled = true;
    dealsButton.textContent = 'Lecture des occasions…';
    const options: DealScanOptions = { pages: 4, maxChecks: 4, rules: config.rules };
    try {
      deals = await scanDeals(api, config.recycle, options);
      dealsHost.replaceChildren(
        h(
          'details',
          { class: 'kc-deals' },
          h('summary', {}, `Occasions du marché (${fmt(deals.deals.length)})`),
          ...(deals.deals.length
            ? deals.deals.map((deal) =>
                h(
                  'div',
                  { class: 'kc-deal' },
                  `${deal.listing.name ?? `Carte #${deal.listing.characterId}`} · ` +
                    `${fmt(deal.listing.price)} ◆ → revente ${fmt(deal.resale)} ◆ · ` +
                    `net ${fmt(deal.net)} ◆ · +${fmt(deal.profit)} ◆`,
                ),
              )
            : [h('div', { class: 'kc-deal' }, 'Aucune occasion ne dépasse les frais.')]),
        ),
      );
    } catch (error) {
      dealsHost.replaceChildren(
        h(
          'div',
          { class: 'kc-deals' },
          `Scan impossible : ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    }
  };

  dealsButton.addEventListener('click', () => {
    if (!result || deals) return;
    void loadDeals(result.config);
  });
  dealsHost.append(dealsButton);

  const restart = async (): Promise<void> => {
    if (closed) return;
    scan?.abort();
    const controller = new AbortController();
    scan = controller;
    result = null;
    deals = null;
    dealsHost.replaceChildren(dealsButton);
    dealsButton.disabled = false;
    dealsButton.textContent = 'Voir les occasions du marché';
    confirm.hidden = true;
    if (!cacheLoaded) {
      const cached = normalizeDuplicateCache(
        await duplicateCacheItem.getValue().catch(() => null),
      );
      if (closed) return;
      cacheLoaded = true;
      if (cached?.rows.length) {
        for (const item of cached.rows) {
          const entry = addRow(item.row);
          if (entry && item.done) markDone(entry);
        }
        paintChips();
        paintBulk();
        status.textContent =
          `Analyse enregistrée ${new Date(cached.at).toLocaleString('fr-FR', {
            day: '2-digit',
            month: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
          })} · actualisation en arrière-plan…`;
      } else {
        status.textContent = 'Lecture de la collection…';
      }
    } else {
      status.textContent = 'Actualisation en arrière-plan…';
    }
    paintSummary();
    void scanDuplicates(api, {
      signal: controller.signal,
      onProgress: (done, total) => {
        if (!closed && scan === controller) {
          status.textContent =
            total > 0
              ? `Actualisation ${fmt(done)} / ${fmt(total)} doublon(s)…`
              : 'Aucun doublon dans la collection.';
        }
      },
      onRow: (row) => {
        if (!closed && scan === controller) {
          addRow(row);
          paintChips();
          paintBulk();
        }
      },
    })
      .then((scanResult) => {
        if (closed || scan !== controller) return;
        result = scanResult;
        status.textContent = scanResult.total
          ? `${fmt(scanResult.total)} doublon(s) analysé(s)` +
            (scanResult.errors ? ` · ${fmt(scanResult.errors)} erreur(s)` : '') +
            ` · ${fmt(recyclableChakra(scanResult.rows))} ◆ récupérables en recyclant les conseils.` +
            (scanResult.stopped ? ' · analyse interrompue.' : '')
          : 'Aucun doublon dans la collection.';
        persist();
        paintSummary();
      })
      .catch((error) => {
        if (closed) return;
        status.textContent = `Analyse impossible : ${error instanceof Error ? error.message : String(error)}`;
      });
  };

  const close = (): void => {
    if (!closed && entries.length) persist();
    closed = true;
    scan?.abort();
    document.removeEventListener('keydown', onKey);
    unregisterSecondaryPanel('collection', close);
    host.remove();
    if (current?.host === host) current = null;
  };
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') close();
  };
  closeButton.addEventListener('click', close);
  document.addEventListener('keydown', onKey);

  const handle: CollectionPanel = { host, root, close, restart };
  current = handle;
  registerSecondaryPanel('collection', close);
  restart();
  return handle;
}
