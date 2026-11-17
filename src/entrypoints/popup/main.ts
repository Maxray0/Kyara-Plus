import { authExpiredItem, sessionItem } from '@/lib/auth';
import {
  budgetLabel,
  budgetSettingsItem,
  budgetStatsItem,
  normalizeBudget,
} from '@/lib/automation/budget';
import { browserWindowDeps, openOrFocusWindow } from '@/lib/detached-window';
import { fmt, h } from '@/lib/dom';
import { autoOpenLogItem, autoOpenStatusItem, packCatalogItem } from '@/lib/auto-open/storage';
import { autoSellLogItem, autoSellStatusItem } from '@/lib/doublons/auto-sell';
import { getTradeSettings, tradeSettingsItem } from '@/lib/doublons/trade-settings';
import { normalizeWishlistCache, wishlistItem } from '@/lib/doublons/wishlist';
import type { ContentRequest } from '@/lib/messages';
import { getSettings, setSetting, settingsItem, type Settings } from '@/lib/settings';
import { catalogItem, statsItem } from '@/lib/stats/store';
import { loadUpdateCheck, storeLinks, updateLabel } from '@/lib/update-check';
import { POPUP_TABS, popupTabFromHash, popupTabHash, type PopupTab } from '@/lib/ui/popup-tabs';

type ToggleKey = 'autoOpen' | 'antiAfk' | 'autoSell';

const TOGGLES: { key: ToggleKey; label: string; hint: string }[] = [
  {
    key: 'autoOpen',
    label: 'Ouverture automatique de boosters',
    hint: 'Pause si le site demande une vérification.',
  },
  { key: 'antiAfk', label: 'Anti-AFK', hint: 'Répond à la boîte « Tu es toujours là ? ».' },
  {
    key: 'autoSell',
    label: 'Vente automatique des doublons',
    hint: 'Selon les réglages de la page Doublons. Garde un onglet kyara.games ouvert.',
  },
];

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T | null;

function text(tag: string, content: string): HTMLElement {
  const element = document.createElement(tag);
  element.textContent = content;
  return element;
}

function checkbox(checked: boolean, onChange: (value: boolean) => void): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));
  return input;
}

function metric(label: string, value: string): HTMLElement {
  return h('div', { class: 'metric' }, h('small', {}, label), h('strong', {}, value));
}

function summaryMetric(label: string, value: number | null | undefined): HTMLElement {
  return metric(label, value === null || value === undefined ? '—' : fmt(value));
}

async function renderConnection(): Promise<void> {
  const element = $('connection');
  if (!element) return;
  const [session, expired] = await Promise.all([
    sessionItem.getValue(),
    authExpiredItem.getValue(),
  ]);
  element.textContent = session
    ? 'Connecté à Kyara.'
    : expired
      ? 'Session expirée : ouvre kyara.games pour reprendre.'
      : 'Ouvre kyara.games pour te connecter.';
}

function renderToggles(settings: Settings): void {
  $('toggles')?.replaceChildren(
    ...TOGGLES.map(({ key, label, hint }) => {
      const wrapper = document.createElement('label');
      wrapper.append(
        checkbox(settings[key], (value) => void setSetting(key, value)),
        text('span', label),
        text('small', hint),
      );
      const item = document.createElement('li');
      item.append(wrapper);
      return item;
    }),
  );
}

async function renderAutoOpen(settings: Settings): Promise<void> {
  const panel = $('auto-open-panel');
  if (!panel) return;
  panel.hidden = !settings.autoOpen;
  if (!settings.autoOpen) return;

  const catalog = (await packCatalogItem.getValue()).filter((pack) => !pack.grantOnly);
  const hint = $('pack-hint');
  if (hint) {
    hint.textContent = catalog.length
      ? 'Coche les boosters concernés.'
      : 'Ouvre kyara.games pour charger la liste des boosters.';
  }
  $('packs')?.replaceChildren(
    ...catalog.map((pack) => {
      const wrapper = document.createElement('label');
      wrapper.append(
        checkbox(settings.autoOpenPackIds.includes(pack.id), (value) => {
          void getSettings().then((current) => {
            const ids = new Set(current.autoOpenPackIds);
            if (value) ids.add(pack.id);
            else ids.delete(pack.id);
            return setSetting('autoOpenPackIds', [...ids]);
          });
        }),
        text('span', pack.name),
      );
      const item = document.createElement('li');
      item.append(wrapper);
      return item;
    }),
  );

  const allow = $<HTMLInputElement>('allow-chakra');
  if (allow) {
    allow.checked = settings.autoOpenAllowChakra;
    allow.onchange = () => void setSetting('autoOpenAllowChakra', allow.checked);
  }
}

/** Statut de la vente automatique : visible seulement quand l'option est activée. */
async function renderSellStatus(settings?: Settings): Promise<void> {
  const element = $('sell-status');
  if (!element) return;
  const current = settings ?? (await getSettings());
  element.hidden = !current.autoSell;
  if (!current.autoSell) return;
  const status = await autoSellStatusItem.getValue();
  element.textContent = status
    ? `Vente auto : ${status.message} · ${status.placed} annonce(s) créée(s)${
        status.nextAt
          ? ` · prochain passage ${new Date(status.nextAt).toLocaleTimeString('fr-FR')}`
          : ''
      }`
    : 'Vente auto : en attente du premier passage (onglet kyara.games requis).';
}

async function renderStatus(): Promise<void> {
  const [status, log] = await Promise.all([
    autoOpenStatusItem.getValue(),
    autoOpenLogItem.getValue(),
  ]);
  const element = $('auto-status');
  if (element) {
    element.textContent = status
      ? `${status.message} · ${status.opened} ouvert(s), ${status.cards} carte(s)`
      : 'Aucune activité.';
  }
  $('log')?.replaceChildren(
    ...log
      .slice(-20)
      .reverse()
      .map((entry) => text('li', `${new Date(entry.t).toLocaleTimeString('fr-FR')} · ${entry.m}`)),
  );
}

function stateLabel(state: string | undefined, enabled: boolean): string {
  if (!enabled) return 'Désactivée';
  if (state === 'running') return 'En cours';
  if (state === 'paused') return 'En pause';
  if (state === 'waiting') return 'En attente';
  if (state === 'stopped') return 'Arrêtée';
  return 'Active';
}

async function renderSellSummary(settings?: Settings): Promise<void> {
  const box = $('sell-summary');
  if (!box) return;
  const current = settings ?? (await getSettings());
  const [status, log] = await Promise.all([
    autoSellStatusItem.getValue(),
    autoSellLogItem.getValue(),
  ]);
  const entries = log.slice(-3).reverse();
  box.replaceChildren(
    h(
      'div',
      { class: 'metrics' },
      metric('Mode', stateLabel(status?.state, current.autoSell)),
      summaryMetric('Annonces actives', status?.active),
      summaryMetric('Créées', status?.placed),
      metric(
        'Prochain passage',
        status?.nextAt ? new Date(status.nextAt).toLocaleTimeString('fr-FR') : '—',
      ),
    ),
    h(
      'p',
      { class: 'note' },
      !current.autoSell
        ? 'Active la vente automatique dans Réglages.'
        : status
          ? status.message
          : 'Aucun passage enregistré. Garde un onglet kyara.games ouvert.',
    ),
    ...(entries.length
      ? [
          h(
            'ul',
            { class: 'mini-log' },
            ...entries.map((entry) =>
              h('li', {}, `${new Date(entry.t).toLocaleTimeString('fr-FR')} · ${entry.m}`),
            ),
          ),
        ]
      : []),
  );
}

async function renderTradeSummary(): Promise<void> {
  const box = $('trade-summary');
  if (!box) return;
  const settings = await getTradeSettings();
  box.replaceChildren(
    h(
      'div',
      { class: 'metrics' },
      metric(
        'Actualisation',
        settings.tradeRefreshMin > 0 ? `Toutes les ${fmt(settings.tradeRefreshMin)} min` : 'Jamais',
      ),
      metric('Rareté reçue', settings.tradeSameRarity ? 'Au moins égale' : 'Libre'),
      metric(
        'Dernière copie',
        settings.tradeUseLast ? `Gain ≥ ${fmt(settings.tradeLastGain)} %` : 'Refusée',
      ),
    ),
    h(
      'p',
      { class: 'note' },
      'Le comptoir se lit et les échanges s’acceptent dans Doublons, après vérification.',
    ),
  );
}

async function renderWishSummary(): Promise<void> {
  const box = $('wish-summary');
  if (!box) return;
  const [wishlist, catalog] = await Promise.all([wishlistItem.getValue(), catalogItem.getValue()]);
  const ids = normalizeWishlistCache(wishlist).ids;
  const names = new Map(
    (catalog?.cards ?? []).map((card) => [Number(card.id), card.name ?? `Carte #${card.id}`]),
  );
  const preview = ids.slice(0, 4).map((id) => names.get(id) ?? `Carte #${id}`);
  box.replaceChildren(
    h(
      'p',
      { class: 'summary-lead' },
      ids.length ? `${fmt(ids.length)} carte(s) dans ta liste.` : 'Aucune carte dans ta liste.',
    ),
    ...(preview.length
      ? [h('ul', { class: 'mini-list' }, ...preview.map((name) => h('li', {}, name)))]
      : []),
    h(
      'p',
      { class: 'note' },
      ids.length
        ? 'La liste complète et l’ajout sont dans Doublons → Envies.'
        : 'La recherche et l’ajout se font dans Doublons → Envies.',
    ),
  );
}

async function renderStatsSummary(): Promise<void> {
  const box = $('stats-summary');
  if (!box) return;
  const data = await statsItem.getValue();
  const self = data ? Object.values(data.accounts).find((account) => account.self) : undefined;
  if (!self) {
    box.replaceChildren(
      h(
        'p',
        { class: 'note' },
        'Aucune statistique enregistrée. Ouvre Stats et synchronise ton compte.',
      ),
    );
    return;
  }
  box.replaceChildren(
    h(
      'div',
      { class: 'metrics' },
      summaryMetric('Cartes', self.owned),
      metric('Valeur', self.value === null ? '—' : `${fmt(self.value)} ◆`),
      self.rankPos === null ? metric('Rang', '—') : metric('Rang', `#${fmt(self.rankPos)}`),
      summaryMetric('Boosters', self.boosters),
    ),
    h(
      'p',
      { class: 'note' },
      data?.at
        ? `Dernière synchronisation : ${new Date(data.at).toLocaleString('fr-FR')}.`
        : 'Aucune synchronisation enregistrée.',
    ),
  );
}

/** Demande à un onglet Kyara de recharger la liste des boosters. */
async function refreshCatalog(): Promise<void> {
  try {
    const tabs = await browser.tabs.query({ url: 'https://kyara.games/*' });
    const tab = tabs.find((candidate) => candidate.active) ?? tabs[0];
    if (tab?.id === undefined) return;
    await browser.tabs.sendMessage(tab.id, { type: 'packs:refresh' } satisfies ContentRequest);
  } catch {
    // Pas d'onglet Kyara : on garde la liste en cache.
  }
}

async function renderAll(): Promise<void> {
  const settings = await getSettings();
  renderToggles(settings);
  void renderSchedule(settings);
  await Promise.all([
    renderAutoOpen(settings),
    renderStatus(),
    renderSellStatus(settings),
    renderSellSummary(settings),
    renderTradeSummary(),
    renderWishSummary(),
    renderStatsSummary(),
  ]);
}

function selectTab(tab: PopupTab, updateHash = false): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-tab]')) {
    const selected = button.dataset.tab === tab;
    button.classList.toggle('on', selected);
    button.setAttribute('aria-selected', String(selected));
    button.tabIndex = selected ? 0 : -1;
  }
  for (const id of POPUP_TABS) {
    const panel = $<HTMLElement>(`panel-${id}`);
    if (panel) panel.hidden = id !== tab;
  }
  if (!updateHash) return;
  const hash = popupTabHash(tab);
  if (location.hash === hash) return;
  try {
    history.replaceState(null, '', hash);
  } catch {
    location.hash = hash;
  }
}

function setupTabs(): void {
  const initial = popupTabFromHash(location.hash);
  selectTab(initial);
  if (location.hash !== popupTabHash(initial)) {
    try {
      history.replaceState(null, '', popupTabHash(initial));
    } catch {
      // Le fragment reste celui fourni par le navigateur.
    }
  }

  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-tab]')) {
    button.addEventListener('click', () => {
      const tab = button.dataset.tab as PopupTab | undefined;
      if (tab && POPUP_TABS.includes(tab)) selectTab(tab, true);
    });
  }

  document.querySelector('.tabs')?.addEventListener('keydown', (event) => {
    if (!(event instanceof KeyboardEvent)) return;
    const target = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>('[data-tab]');
    if (!target) return;
    const current = popupTabFromHash(target.dataset.tab ?? '');
    const index = POPUP_TABS.indexOf(current);
    if (index < 0) return;
    let next: number | undefined;
    if (event.key === 'ArrowRight') next = (index + 1) % POPUP_TABS.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + POPUP_TABS.length) % POPUP_TABS.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = POPUP_TABS.length - 1;
    else return;
    event.preventDefault();
    const tab = POPUP_TABS[next];
    if (!tab) return;
    selectTab(tab, true);
    document.getElementById(`tab-${tab}`)?.focus();
  });

  window.addEventListener('hashchange', () => {
    selectTab(popupTabFromHash(location.hash));
  });
}

async function renderSchedule(settings?: Settings): Promise<void> {
  const current = settings ?? (await getSettings());
  const idle = $('auto-open-idle') as HTMLInputElement | null;
  if (idle) idle.value = String(current.autoOpenIdleSec);
  const budget = normalizeBudget(await budgetSettingsItem.getValue());
  const perMinute = $('budget-per-minute') as HTMLInputElement | null;
  const minGap = $('budget-min-gap') as HTMLInputElement | null;
  if (perMinute) perMinute.value = String(budget.perMinute);
  if (minGap) minGap.value = String(budget.minGapMs);
  const status = $('budget-status');
  if (status) status.textContent = budgetLabel(await budgetStatsItem.getValue());
}

function bindSchedule(): void {
  $('auto-open-idle')?.addEventListener('change', (event) => {
    const input = event.currentTarget as HTMLInputElement;
    void setSetting('autoOpenIdleSec', Number(input.value)).then(() => renderSchedule());
  });
  const saveBudget = (): void => {
    const perMinute = $('budget-per-minute') as HTMLInputElement | null;
    const minGap = $('budget-min-gap') as HTMLInputElement | null;
    void budgetSettingsItem
      .setValue(
        normalizeBudget({
          perMinute: Number(perMinute?.value),
          minGapMs: Number(minGap?.value),
        }),
      )
      .then(() => renderSchedule());
  };
  $('budget-per-minute')?.addEventListener('change', saveBudget);
  $('budget-min-gap')?.addEventListener('change', saveBudget);
  budgetStatsItem.watch(() => void renderSchedule());
  budgetSettingsItem.watch(() => void renderSchedule());
}

async function renderFooter(): Promise<void> {
  const version = $('version');
  if (version) version.textContent = `Version ${browser.runtime.getManifest().version}`;
  const links = $('publish-links');
  if (links) {
    links.replaceChildren(
      ...storeLinks().map((link) =>
        h(
          'a',
          { href: link.href, target: '_blank', rel: 'noreferrer' },
          link.label,
        ),
      ),
    );
  }
  const update = $('update');
  if (!update) return;
  const runtime = browser.runtime as unknown as {
    requestUpdateCheck?: () => Promise<{ status?: string; details?: { version?: string } }>;
  };
  const check = await loadUpdateCheck(runtime);
  update.textContent = updateLabel(check);
  update.hidden = check.status === 'unknown' && check.at === null;
}

setupTabs();
bindSchedule();
void renderConnection();
void renderFooter();
void renderSchedule();
void refreshCatalog().then(renderAll);
$('open-stats-window')?.addEventListener('click', () => {
  void openOrFocusWindow(browserWindowDeps(browser.runtime.getURL('/stats.html'))).then(() =>
    window.close(),
  );
});
sessionItem.watch(() => void renderConnection());
authExpiredItem.watch(() => void renderConnection());
settingsItem.watch(() => void renderAll());
packCatalogItem.watch(() => void renderAll());
autoOpenStatusItem.watch(() => void renderStatus());
autoSellStatusItem.watch(() => {
  void renderSellStatus();
  void renderSellSummary();
});
autoSellLogItem.watch(() => void renderSellSummary());
tradeSettingsItem.watch(() => void renderTradeSummary());
wishlistItem.watch(() => void renderWishSummary());
catalogItem.watch(() => void renderWishSummary());
statsItem.watch(() => void renderStatsSummary());
autoOpenLogItem.watch(() => void renderStatus());
