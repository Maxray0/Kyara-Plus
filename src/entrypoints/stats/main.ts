import { AuthError } from '@/lib/api';
import { sessionItem } from '@/lib/auth';
import { getCatalog } from '@/lib/catalog';
import { createRelayClient } from '@/lib/relay';
import {
  addAccount,
  ensureSelf,
  importFriends,
  loadProfile,
  removeAccount,
  syncAccounts,
  type ProfileView,
} from '@/lib/stats/board';
import {
  STAT_CACHE_MS,
  STAT_COLUMNS,
  STAT_MAX_ACCOUNTS,
  columnOf,
  columnValue,
  pieSlices,
  rankRows,
  record,
  sortAccounts,
  type Account,
  type CatalogCard,
  type ColumnKey,
  type StatData,
} from '@/lib/stats/model';
import { fetchFriendList, searchLadder, searchPlayers, type PlayerHit } from '@/lib/stats/remote';
import { loadStats, saveStats } from '@/lib/stats/store';

const api = createRelayClient({
  queryTabs: () => browser.tabs.query({ url: 'https://kyara.games/*' }),
  sendToTab: (tabId, request) => browser.tabs.sendMessage(tabId, request),
});

let data: StatData;
let catalog: CatalogCard[] = [];
let busy = false;
let expanded: string | null = null;
let results: PlayerHit[] | null = null;
let searchSeq = 0;
let profileSeq = 0;

type Child = Node | string | null | false | undefined;
type Attrs = Record<string, string | boolean | ((event: Event) => void) | undefined>;

function h(tag: string, attrs: Attrs = {}, ...children: Child[]): HTMLElement {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (typeof value === 'function') element.addEventListener(key.slice(2), value);
    else if (key === 'class') element.className = String(value);
    else element.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    element.append(child);
  }
  return element;
}

const $ = (id: string) => document.getElementById(id) as HTMLElement;

function fill(parent: HTMLElement, ...children: Child[]): void {
  parent.replaceChildren(...children.filter((child): child is Node | string => !!child));
}
const fmt = (n: number) => n.toLocaleString('fr-FR');
const fmtDate = (ts: number) =>
  ts > 0
    ? new Date(ts).toLocaleDateString('fr-FR', {
        day: '2-digit',
        month: '2-digit',
        year: '2-digit',
      })
    : 'jamais';

/** Seuls les liens relatifs au site et https sont acceptés pour les avatars. */
function avatarUrl(value: string | null): string | null {
  if (!value) return null;
  if (value.startsWith('/') && !value.startsWith('//')) return `https://kyara.games${value}`;
  return value.startsWith('https://') ? value : null;
}

function avatar(value: string | null): HTMLElement | null {
  const src = avatarUrl(value);
  return src ? h('img', { src, alt: '', loading: 'lazy' }) : null;
}

function setStatus(message: string, isError = false): void {
  const status = $('status');
  status.textContent = message;
  status.className = isError ? 'error' : '';
}

function cell(account: Account, key: ColumnKey): HTMLElement {
  const value = columnValue(account, key);
  if (value === null) return h('td', {}, h('span', { class: 'na' }, '—'));
  if (key === 'rankPos') return h('td', {}, `#${fmt(value)}`);
  if (key === 'catalogPct') return h('td', {}, `${value.toLocaleString('fr-FR')} %`);
  if (key === 'value') return h('td', {}, `◆ ${fmt(value)}`);
  return h('td', {}, fmt(value));
}

function pairs(row: Account): [string, string][] {
  const avg = row.value !== null && row.owned ? row.value / row.owned : null;
  return [
    [
      'Origine',
      row.self ? 'compte connecté' : row.source === 'friend' ? 'liste d’amis' : 'ajout manuel',
    ],
    ['Rang global (site)', row.rankPos === null ? '—' : `#${fmt(row.rankPos)}`],
    ['Valeur des doublons', row.dupesValue === null ? 'non publié' : `◆ ${fmt(row.dupesValue)}`],
    ['Valeur moyenne par carte', avg === null ? '—' : `◆ ${fmt(Math.round(avg))}`],
    ['Séries presque finies (≤ 3)', row.seriesAlmost === null ? '—' : fmt(row.seriesAlmost)],
    [
      'Cartes valorisées',
      row.value === null
        ? '—'
        : `${fmt(row.valuePriced)}${row.valueUnpriced ? ` · ${fmt(row.valueUnpriced)} sans prix` : ''}`,
    ],
    ['Valeur mesurée le', row.valueAt ? fmtDate(row.valueAt) : '—'],
  ];
}

function detail(row: Account): HTMLElement {
  return h(
    'div',
    {},
    h(
      'div',
      { class: 'grid' },
      ...pairs(row).map(([label, value]) => h('div', {}, h('span', {}, label), h('b', {}, value))),
    ),
    h(
      'p',
      { class: 'actions' },
      h(
        'button',
        { type: 'button', disabled: busy, onclick: () => void run([row.id]) },
        'Relire ce compte',
      ),
      !row.self &&
        h(
          'button',
          {
            type: 'button',
            onclick: () => void commit(removeAccount(data, row.id)),
          },
          'Retirer',
        ),
    ),
    row.error && h('p', { class: 'err' }, row.error),
    row.valueUnpriced
      ? h(
          'p',
          { class: 'muted' },
          `${fmt(row.valueUnpriced)} carte(s) sans prix officiel : non comptées dans la valeur.`,
        )
      : null,
  );
}

function renderBoard(): void {
  const rows = Object.values(data.accounts);
  const column = columnOf(data.sort);
  const sorted = sortAccounts(rows, column.key, data.bestFirst);
  const ranks = rankRows(rows, column.key, data.bestFirst);
  const valued = rows.filter((row) => row.value !== null);

  $('summary').replaceChildren(
    ...[
      ['Comptes', fmt(rows.length), `${fmt(data.ownerTotal)} collection(s) lue(s)`],
      [
        'Valeur cumulée',
        `◆ ${fmt(valued.reduce((sum, row) => sum + (row.value ?? 0), 0))}`,
        `${fmt(valued.length)} compte(s) valorisé(s)`,
      ],
      [
        'Cartes différentes',
        fmt(rows.reduce((sum, row) => sum + (row.owned ?? 0), 0)),
        'somme des comptes',
      ],
    ].map(([label, value, hint]) =>
      h(
        'div',
        { class: 'card' },
        h('span', {}, label),
        h('b', {}, value),
        h('small', { class: 'muted' }, hint),
      ),
    ),
  );

  const head = h(
    'tr',
    {},
    h('th', {}, '#'),
    h('th', {}, 'Compte'),
    ...STAT_COLUMNS.map((c) => {
      const active = c.key === column.key;
      const arrow = active ? ((c.asc ? !data.bestFirst : data.bestFirst) ? ' ▾' : ' ▴') : '';
      return h(
        'th',
        { class: active ? 'active' : '', title: c.title },
        h(
          'button',
          {
            type: 'button',
            onclick: () =>
              void commit({
                ...data,
                sort: c.key,
                bestFirst: active ? !data.bestFirst : true,
              }),
          },
          `${c.label}${arrow}`,
        ),
      );
    }),
  );

  const body = sorted.flatMap((row) => {
    const rank = ranks.get(row.id) ?? null;
    const line = h(
      'tr',
      {
        class: 'row',
        title: row.error ?? '',
        onclick: () => {
          expanded = expanded === row.id ? null : row.id;
          renderBoard();
        },
      },
      h('td', { class: 'muted' }, rank === null ? '·' : `#${rank}`),
      h(
        'td',
        {},
        h(
          'span',
          { class: 'who' },
          avatar(row.avatar),
          h('span', {}, row.pseudo),
          row.self && h('em', {}, 'moi'),
          row.source === 'friend' && h('em', {}, 'ami'),
        ),
      ),
      ...STAT_COLUMNS.map((c) => cell(row, c.key)),
    );
    if (expanded !== row.id) return [line];
    return [
      line,
      h(
        'tr',
        { class: 'detail' },
        h('td', { colspan: String(STAT_COLUMNS.length + 2) }, detail(row)),
      ),
    ];
  });

  const pie = pieSlices(rows, column.key);
  const stops: string[] = [];
  let cursor = 0;
  pie.slices.forEach((slice, index) => {
    const end =
      slice.pct <= 0 ? cursor : index === pie.slices.length - 1 ? 100 : cursor + slice.pct;
    stops.push(`${slice.color} ${cursor.toFixed(2)}% ${end.toFixed(2)}%`);
    cursor = end;
  });
  const pieEl = h('div', {
    class: 'pie',
    role: 'img',
    'aria-label': `Répartition : ${column.title}`,
  });
  pieEl.style.background = stops.length ? `conic-gradient(${stops.join(',')})` : '#2d303a';

  $('board').replaceChildren(
    rows.length
      ? h(
          'div',
          { class: 'layout' },
          h(
            'div',
            { class: 'scroll' },
            h('table', {}, h('thead', {}, head), h('tbody', {}, ...body)),
          ),
          h(
            'aside',
            {},
            h('h2', {}, column.title),
            pieEl,
            h(
              'div',
              { class: 'legend' },
              ...pie.slices.map((slice) => {
                const color = h('i');
                color.style.background = slice.color;
                return h(
                  'div',
                  {},
                  color,
                  h('span', {}, slice.label),
                  h(
                    'b',
                    {},
                    pie.mode === 'buckets' ? `${fmt(slice.value)}` : fmt(Math.round(slice.value)),
                  ),
                  h('small', { class: 'muted' }, `${slice.pct.toFixed(1).replace('.', ',')} %`),
                );
              }),
            ),
          ),
        )
      : h('p', { class: 'muted' }, 'Aucun compte suivi : cherche un joueur pour commencer.'),
  );
}

async function commit(next: StatData): Promise<void> {
  data = next;
  await saveStats(data);
  renderBoard();
  renderResults();
}

async function run(only?: readonly string[]): Promise<void> {
  if (busy) return;
  busy = true;
  const controller = new AbortController();
  $('refresh').setAttribute('disabled', '');
  $('friends').setAttribute('disabled', '');
  try {
    data = await syncAccounts(
      data,
      {
        api,
        catalog,
        now: Date.now,
        onProgress: (message, done, total) =>
          setStatus(`${message} ${total ? `${fmt(done)}/${fmt(total)}` : ''}`),
      },
      controller.signal,
      only,
    );
    await saveStats(data);
    setStatus(`Mesure du ${fmtDate(data.at)}. Clique sur un compte pour le détail.`);
  } catch (error) {
    setStatus(
      error instanceof AuthError
        ? 'Session expirée : ouvre kyara.games puis réessaie.'
        : `Lecture impossible : ${error instanceof Error ? error.message : 'erreur inconnue'}`,
      true,
    );
  } finally {
    busy = false;
    $('refresh').removeAttribute('disabled');
    $('friends').removeAttribute('disabled');
    renderBoard();
  }
}

async function importMyFriends(): Promise<void> {
  if (busy) return;
  setStatus('Lecture de la liste d’amis…');
  try {
    const friends = await fetchFriendList(api);
    const result = importFriends(data, friends, Date.now());
    await commit(result.data);
    setStatus(`${fmt(result.imported)} ami(s) importé(s) · ${fmt(result.ignored)} ignoré(s)`);
    if (result.imported) await run();
  } catch (error) {
    setStatus(
      `Liste d’amis inaccessible : ${error instanceof Error ? error.message : 'erreur inconnue'}`,
      true,
    );
  }
}

function renderResults(): void {
  const box = $('results');
  if (!results) return box.replaceChildren();
  if (!results.length)
    return box.replaceChildren(h('p', { class: 'muted' }, 'Aucun joueur trouvé.'));
  box.className = 'results';
  box.replaceChildren(
    ...results.slice(0, 12).map((hit) => {
      const followed = Boolean(data.accounts[hit.id]);
      return h(
        'div',
        { class: 'hit' },
        avatar(hit.avatar),
        h(
          'div',
          { class: 'grow' },
          h('b', {}, hit.pseudo),
          h(
            'div',
            {},
            h(
              'small',
              {},
              [
                hit.owned !== null ? `${fmt(hit.owned)} carte(s)` : 'collection inconnue',
                hit.pos !== null ? `rang #${fmt(hit.pos)}` : '',
              ]
                .filter(Boolean)
                .join(' · '),
            ),
          ),
        ),
        h('button', { type: 'button', onclick: () => void showProfile(hit) }, 'Profil'),
        h(
          'button',
          {
            type: 'button',
            disabled: followed,
            onclick: async () => {
              const result = addAccount(data, hit, 'manual', Date.now());
              if (!result.added) {
                setStatus(
                  result.reason === 'full'
                    ? `Limite de ${STAT_MAX_ACCOUNTS} comptes atteinte.`
                    : 'Déjà suivi.',
                  true,
                );
                return;
              }
              await commit(result.data);
              await run([hit.id]);
            },
          },
          followed ? 'Suivi' : 'Ajouter',
        ),
      );
    }),
  );
}

async function search(query: string): Promise<void> {
  const seq = ++searchSeq;
  if (query.length < 2) {
    results = null;
    return renderResults();
  }
  setStatus('Recherche…');
  try {
    let found = await searchPlayers(api, query).catch(() => [] as PlayerHit[]);
    if (!found.length) found = await searchLadder(api, query).catch(() => []);
    if (seq !== searchSeq) return;
    const needle = query.toLowerCase();
    const weight = (hit: PlayerHit) => {
      const name = hit.pseudo.toLowerCase();
      return name === needle ? 0 : name.startsWith(needle) ? 1 : name.includes(needle) ? 2 : 3;
    };
    results = found.sort((a, b) => weight(a) - weight(b) || (b.owned ?? 0) - (a.owned ?? 0));
    setStatus('');
  } catch (error) {
    if (seq !== searchSeq) return;
    results = null;
    setStatus(error instanceof Error ? error.message : 'Recherche impossible', true);
  }
  renderResults();
}

function renderProfile(hit: PlayerHit, view: ProfileView | null, note: string): void {
  const box = $('profile');
  box.hidden = false;
  const user = view?.user ?? {};
  const value = view?.value;
  fill(
    box,
    h(
      'div',
      { class: 'top' },
      h('h2', {}, `Profil de ${String(user.pseudo ?? hit.pseudo)}`),
      h('button', { type: 'button', onclick: () => (box.hidden = true) }, 'Fermer'),
    ),
    note && h('p', { class: 'muted' }, note),
    value &&
      h(
        'div',
        { class: 'grid' },
        ...(
          [
            ['Cartes différentes', value.uniques !== null ? fmt(value.uniques) : '—'],
            [
              'Valeur de la collection',
              value.exact
                ? `◆ ${fmt(value.total)}`
                : 'illisible (collection privée ou indisponible)',
            ],
            [
              'Cartes valorisées',
              value.exact ? `${fmt(value.priced)} · ${fmt(value.unknown)} sans prix` : '—',
            ],
            [
              'Répartition',
              Object.entries(value.byRarity)
                .map(([rarity, count]) => `${rarity} ${fmt(count)}`)
                .join(' · ') || '—',
            ],
            [
              'Valeur par rareté',
              Object.entries(value.rarityValue)
                .sort((a, b) => b[1] - a[1])
                .map(([rarity, total]) => `${rarity} ◆ ${fmt(total)}`)
                .join(' · ') || '—',
            ],
          ] as [string, string][]
        ).map(([label, text]) => h('div', {}, h('span', {}, label), h('b', {}, text))),
      ),
    value?.best.length
      ? h(
          'div',
          {},
          h('h2', {}, 'Meilleures cartes'),
          ...value.best.map((card) =>
            h(
              'div',
              {},
              `${card.name} (${card.rarity || '?'}) · ${card.price === null ? '—' : `◆ ${fmt(card.price)}`}`,
            ),
          ),
        )
      : null,
  );
}

async function showProfile(hit: PlayerHit): Promise<void> {
  const seq = ++profileSeq;
  renderProfile(hit, null, 'Chargement du profil…');
  try {
    const view = await loadProfile(api, hit.id, catalog, (done, total) => {
      if (seq === profileSeq)
        renderProfile(hit, null, `Prix officiels… ${fmt(done)}/${fmt(total)}`);
    });
    if (seq !== profileSeq) return;
    renderProfile(
      hit,
      view,
      view.user ? '' : 'Profil introuvable ou privé : seules les infos publiques sont affichées.',
    );
  } catch (error) {
    if (seq !== profileSeq) return;
    renderProfile(
      hit,
      null,
      error instanceof AuthError
        ? 'Session expirée : ouvre kyara.games puis réessaie.'
        : `Profil inaccessible : ${error instanceof Error ? error.message : 'erreur inconnue'}`,
    );
  }
}

async function init(): Promise<void> {
  data = await loadStats();
  renderBoard();
  if (!(await sessionItem.getValue())) {
    setStatus('Ouvre kyara.games et connecte-toi pour lire les statistiques.', true);
    return;
  }
  try {
    setStatus('Chargement…');
    catalog = await getCatalog(api);
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
    renderBoard();
    const stale = !data.at || Date.now() - data.at > STAT_CACHE_MS;
    const pending = Object.values(data.accounts).some((row) => !row.at);
    if (stale || pending) await run();
    else setStatus(`Mesure du ${fmtDate(data.at)}. Clique sur un compte pour le détail.`);
  } catch (error) {
    setStatus(
      error instanceof AuthError
        ? 'Session expirée : ouvre kyara.games puis rouvre cette page.'
        : `Chargement impossible : ${error instanceof Error ? error.message : 'erreur inconnue'}`,
      true,
    );
  }
}

$('refresh').addEventListener('click', () => void run());
$('friends').addEventListener('click', () => void importMyFriends());
$('search-form').addEventListener('submit', (event) => {
  event.preventDefault();
  void search((document.getElementById('query') as HTMLInputElement).value.trim());
});

void init();
