const PENDING_KEY = 'bk-pending-state';
const FROM_KEY = 'bk-from-collection';
const FROM_TTL = 30 * 60 * 1000;
const PENDING_TTL = 30 * 1000;
const HAVE_RE = /([\d\s\u00a0\u202f]+)\/\s*([\d\s\u00a0\u202f]+)\s*poss/i;

export const RARITY_COLORS: Record<string, string> = {
  mythique: '#ff4d2e',
  légendaire: '#f5c518',
  épique: '#b072ff',
  rare: '#4d9bff',
  'peu commune': '#3fbf7f',
};

export function rarityColor(label: string): string {
  return RARITY_COLORS[label.trim().toLowerCase()] ?? '#5a5662';
}

/** Retire le décor du titre du site : « Nom (UNIVERS) — carte Rareté · Kyara ». */
export function cleanTitle(title: string): string {
  return title
    .replace(/\s*[—-]\s*carte\s+.*$/i, '')
    .replace(/\s*·\s*Kyara.*$/i, '')
    .trim();
}

/** Sépare nom et univers sur la dernière parenthèse. */
export function splitTitle(full: string): { name: string; series: string } {
  const match = full.match(/^(.*?)\s*\(([^()]*)\)\s*$/);
  return match
    ? { name: (match[1] ?? '').trim(), series: (match[2] ?? '').trim() }
    : { name: full, series: '' };
}

export interface CardPage {
  name: string;
  series: string;
  image: string;
  /** Miniature du site, utilisée si la grande image est introuvable. */
  thumb: string;
}

/** Lit la fiche /wiki/{id} d'une carte : nom, univers et grande image. */
export function parseCardPage(doc: Document, url: string, origin: string): CardPage {
  const id = new URL(url).pathname.split('/').filter(Boolean).pop();
  const art = doc.querySelector('.tcg .art img[src*="/cards/"],.art img[src*="/cards/"]');
  const image = new URL(art?.getAttribute('src') || `/cards/lg/${id}.webp`, origin).href.replace(
    /\.(png|jpe?g)(?=($|[?#]))/i,
    '.webp',
  );
  const thumb = new URL(`/cards/sm/${id}.webp`, origin).href;
  const og = doc.querySelector<HTMLMetaElement>('meta[property="og:title"]')?.content || '';
  const title = doc.querySelector('title')?.textContent || '';
  return { ...splitTitle(cleanTitle(og || title)), image, thumb };
}

/** Pourcentage possédé, lu dans « 1 234 / 5 678 poss. » ; null si le texte n'a pas cette forme. */
export function ownedPercent(text: string): string | null {
  const match = text.match(HAVE_RE);
  if (!match) return null;
  const owned = parseInt((match[1] ?? '').replace(/\D/g, ''), 10);
  const total = parseInt((match[2] ?? '').replace(/\D/g, ''), 10);
  if (!total || Number.isNaN(owned)) return null;
  return `${((owned / total) * 100).toLocaleString('fr-FR', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}\u00a0%`;
}

interface FilterState {
  q: string;
  sel: Record<string, string>;
  chip: number;
  view: number;
  y: number;
}

export interface CollectionOptions {
  document: Document;
  fetchImpl?: typeof fetch;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Améliorations de la page « Ma collection » : aperçu des cartes manquantes, bouton Actualiser
 * qui garde filtres et défilement, retour à la collection depuis une fiche, pourcentage possédé
 * sur la page d'un booster.
 */
export function startCollectionEnhancements(options: CollectionOptions) {
  const doc = options.document;
  const view = doc.defaultView as Window & typeof globalThis;
  const location = view.location;
  const fetchImpl = options.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const session = view.sessionStorage;

  interface Job {
    a: HTMLAnchorElement;
    url: string;
    attempts: number;
  }
  const jobs: Job[] = [];
  const MAX_ATTEMPTS = 3;
  let active = 0;
  let refreshing = false;
  let returning = false;

  async function read(url: string): Promise<CardPage> {
    const response = await fetchImpl(url, { credentials: 'include', cache: 'no-store' });
    // Une page d'erreur ne doit pas être lue comme une fiche de carte.
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const page = new view.DOMParser().parseFromString(await response.text(), 'text/html');
    return parseCardPage(page, url, location.origin);
  }

  function paint(a: HTMLAnchorElement, card: CardPage): void {
    const box = a.querySelector<HTMLElement>('.miss');
    if (!box || box.dataset.bk) return;
    box.dataset.bk = '1';
    const label = (a.querySelector('.r')?.textContent || '').trim().toLowerCase();
    a.style.setProperty('--kyara-rarity', rarityColor(label));
    a.dataset.bkRarity = label;
    box.style.cssText +=
      ';position:relative!important;overflow:hidden!important;min-height:240px!important';

    const image = new view.Image();
    image.className = 'kyara-peek-img';
    image.alt = '';
    // Grande image introuvable : miniature du site, puis plus d'image plutôt qu'un cadre cassé.
    let fellBack = false;
    image.addEventListener('error', () => {
      if (!fellBack && card.thumb && image.src !== card.thumb) {
        fellBack = true;
        image.src = card.thumb;
      } else {
        image.remove();
      }
    });
    image.src = card.image;

    const name = doc.createElement('div');
    name.className = 'kyara-peek-name';
    name.textContent = card.name;
    if (card.series) {
      const series = doc.createElement('span');
      series.className = 'kyara-peek-series';
      series.textContent = card.series;
      name.append(series);
    }
    const badge = doc.createElement('div');
    badge.className = 'kyara-peek-badge';
    badge.textContent = 'NON DÉBLOQUÉE';

    box.insertBefore(image, box.firstChild);
    box.append(name, badge);
  }

  function run(): void {
    if (active >= 3) return;
    const job = jobs.shift();
    if (!job) return;
    active += 1;
    read(job.url)
      .then((card) => paint(job.a, card))
      .catch(() => {
        // Lecture ratée (limite de débit, réseau) : nouvel essai plus tard au lieu d'abandonner.
        if (job.attempts + 1 < MAX_ATTEMPTS && job.a.isConnected) {
          setTimeout(
            () => {
              jobs.push({ ...job, attempts: job.attempts + 1 });
              run();
            },
            1500 * (job.attempts + 1),
          );
        }
      })
      .finally(() => {
        active -= 1;
        setTimeout(run, 150);
        run();
      });
  }

  const peekObserver = new view.IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const a = entry.target as HTMLAnchorElement;
        peekObserver.unobserve(a);
        jobs.push({
          a,
          url: new URL(a.getAttribute('href') ?? '', location.href).href,
          attempts: 0,
        });
        run();
        run();
        run();
      }
    },
    { rootMargin: '600px' },
  );

  function scanMissing(): void {
    doc.querySelectorAll<HTMLAnchorElement>('a.slot[href^="/wiki/"]').forEach((a) => {
      if (a.querySelector('.miss') && !a.dataset.bkq) {
        a.dataset.bkq = '1';
        peekObserver.observe(a);
      }
    });
  }

  async function waitFor(test: () => unknown, timeout = 10_000): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      try {
        if (test()) return true;
      } catch {
        // Le DOM change pendant la lecture : on réessaie.
      }
      await sleep(80);
    }
    return false;
  }

  function readState(): FilterState {
    const sel: Record<string, string> = {};
    doc.querySelectorAll('.selects label').forEach((label) => {
      const key = label.querySelector('span')?.textContent?.trim();
      const select = label.querySelector('select');
      if (key && select) sel[key] = select.value;
    });
    return {
      q: doc.querySelector<HTMLInputElement>('#q')?.value || '',
      sel,
      chip: [...doc.querySelectorAll('.chips .chip')].findIndex(
        (c) => c.getAttribute('aria-pressed') === 'true',
      ),
      view: [...doc.querySelectorAll('.views button')].findIndex(
        (b) => b.getAttribute('aria-pressed') === 'true',
      ),
      y: view.scrollY,
    };
  }

  async function restoreState(state: FilterState): Promise<void> {
    const views = [...doc.querySelectorAll<HTMLButtonElement>('.views button')];
    const wantedView = views[state.view];
    if (state.view >= 0 && wantedView?.getAttribute('aria-pressed') !== 'true') {
      wantedView?.click();
      await sleep(120);
    }
    const chips = [...doc.querySelectorAll<HTMLButtonElement>('.chips .chip')];
    const wantedChip = chips[state.chip];
    if (state.chip >= 0 && wantedChip?.getAttribute('aria-pressed') !== 'true') {
      wantedChip?.click();
      await sleep(120);
    }
    for (const label of doc.querySelectorAll('.selects label')) {
      const key = label.querySelector('span')?.textContent?.trim();
      const select = label.querySelector('select');
      if (select && key && key in state.sel && select.value !== state.sel[key]) {
        select.value = state.sel[key] ?? '';
        select.dispatchEvent(new view.Event('input', { bubbles: true }));
        select.dispatchEvent(new view.Event('change', { bubbles: true }));
        await sleep(120);
      }
    }
    const q = doc.querySelector<HTMLInputElement>('#q');
    if (q && state.q && q.value !== state.q) {
      q.value = state.q;
      q.dispatchEvent(new view.Event('input', { bubbles: true }));
      await sleep(120);
    }
    view.scrollTo(0, state.y);
  }

  const collectionLink = () => doc.querySelector<HTMLElement>('a.navlink[href="/collection"]');
  const collectionReady = () => doc.querySelector('#q') && doc.querySelector('.grid .cell');

  function overlay(text: string): HTMLElement {
    const element = doc.createElement('div');
    element.id = 'bk-overlay';
    element.textContent = text;
    doc.body.appendChild(element);
    return element;
  }

  /** Réessaie le clic jusqu'à ce que l'URL soit /collection. */
  async function goToCollection(): Promise<boolean> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      collectionLink()?.click();
      if (await waitFor(() => location.pathname === '/collection', 6000)) return true;
    }
    return false;
  }

  async function refreshCollection(button: HTMLButtonElement): Promise<void> {
    if (refreshing) return;
    const via =
      doc.querySelector<HTMLElement>('footer a[href="/raretes"]') ||
      doc.querySelector<HTMLElement>('a.navlink[href="/marche"]');
    if (!via || !collectionLink()) return;

    refreshing = true;
    button.disabled = true;
    const state = readState();
    // Sauvegarde de secours, utilisée seulement si la page doit se recharger.
    session.setItem(PENDING_KEY, JSON.stringify({ t: Date.now(), state }));
    const cover = overlay('Actualisation de la collection…');
    try {
      via.click();
      await waitFor(() => location.pathname !== '/collection', 8000);
      await waitFor(() => !doc.querySelector('.toolbar'), 8000);
      await sleep(500);

      let ok = await goToCollection();
      if (!ok) {
        history.back();
        ok = await waitFor(() => location.pathname === '/collection', 6000);
      }
      if (!ok) {
        location.href = '/collection';
        return;
      }
      await waitFor(collectionReady, 15_000);
      await sleep(150);
      await restoreState(state);
      session.removeItem(PENDING_KEY);
    } finally {
      cover.remove();
      refreshing = false;
      button.disabled = false;
    }
  }

  /** Restaure les filtres si la page a dû être rechargée pendant l'actualisation. */
  async function restorePending(): Promise<void> {
    const raw = session.getItem(PENDING_KEY);
    if (!raw || location.pathname !== '/collection') return;
    session.removeItem(PENDING_KEY);
    let saved: { t: number; state: FilterState } | undefined;
    try {
      saved = JSON.parse(raw);
    } catch {
      return;
    }
    if (!saved?.state || Date.now() - saved.t > PENDING_TTL) return;
    if (await waitFor(collectionReady, 15_000)) {
      await sleep(200);
      await restoreState(saved.state);
    }
  }

  // Au clic sur une carte depuis la collection, on mémorise les filtres.
  const rememberFilters = (event: Event) => {
    if (location.pathname !== '/collection') return;
    const link = (event.target as Element | null)?.closest?.(
      'a.slot[href^="/wiki/"], a.wiki[href^="/wiki/"]',
    );
    if (link) session.setItem(FROM_KEY, JSON.stringify({ t: Date.now(), state: readState() }));
  };
  doc.addEventListener('click', rememberFilters, true);

  function readFrom(): { t: number; state: FilterState } | null {
    try {
      const saved = JSON.parse(session.getItem(FROM_KEY) || 'null');
      if (!saved?.state || Date.now() - saved.t > FROM_TTL) {
        session.removeItem(FROM_KEY);
        return null;
      }
      return saved;
    } catch {
      session.removeItem(FROM_KEY);
      return null;
    }
  }

  /** Nettoie la mémoire quand on n'est plus dans le parcours collection → carte. */
  function syncRoute(): void {
    const path = location.pathname;
    if (path !== '/collection' && !path.startsWith('/wiki/')) session.removeItem(FROM_KEY);
    if (path !== '/wiki' && !path.startsWith('/wiki/')) doc.querySelector('#bk-back')?.remove();
  }

  async function backToCollection(button: HTMLButtonElement): Promise<void> {
    if (returning) return;
    const saved = readFrom();
    if (!saved || !collectionLink()) return;
    returning = true;
    button.disabled = true;
    const cover = overlay('Retour à la collection…');
    try {
      if (!(await goToCollection())) {
        // Secours : rechargement complet, filtres restaurés au chargement.
        session.setItem(PENDING_KEY, JSON.stringify({ t: Date.now(), state: saved.state }));
        location.href = '/collection';
        return;
      }
      await waitFor(collectionReady, 15_000);
      await sleep(200);
      await restoreState(saved.state);
      await sleep(150);
      view.scrollTo(0, saved.state.y);
      session.removeItem(FROM_KEY);
    } finally {
      cover.remove();
      returning = false;
      button.disabled = false;
    }
  }

  function injectBackButton(): void {
    if (!location.pathname.startsWith('/wiki/') || doc.querySelector('#bk-back') || !readFrom())
      return;
    const button = doc.createElement('button');
    button.id = 'bk-back';
    button.type = 'button';
    button.className = 'btn btn-ghost btn-sm';
    button.textContent = '← Retour à la collection';
    button.setAttribute('aria-label', 'Retour à la collection avec les filtres');
    button.addEventListener('click', () => void backToCollection(button));
    const crumbs = doc.querySelector('.hero-in .crumbs');
    if (crumbs?.parentElement) {
      crumbs.parentElement.insertBefore(button, crumbs);
    } else {
      button.classList.add('bk-floating');
      doc.body.appendChild(button);
    }
  }

  const mobile = view.matchMedia('(max-width: 720px)');

  function injectRefreshButton(): void {
    if (location.pathname !== '/collection') return;
    const row1 = doc.querySelector('.toolbar .row1');
    const chips = doc.querySelector('.toolbar .row2 .chips');
    if (!row1 || !chips) return;
    let button = doc.querySelector<HTMLButtonElement>('#bk-refresh');
    if (!button) {
      const created = doc.createElement('button');
      created.id = 'bk-refresh';
      created.type = 'button';
      created.className = 'btn btn-ghost btn-sm';
      created.textContent = '↻ Actualiser';
      created.setAttribute('aria-label', 'Actualiser la collection');
      created.addEventListener('click', () => void refreshCollection(created));
      button = created;
    }
    // Mobile : dans .row1 après Cartes / Albums. Ordinateur : après Mythique.
    const target = mobile.matches ? row1 : chips;
    if (button.parentElement !== target) target.appendChild(button);
  }
  mobile.addEventListener?.('change', injectRefreshButton);

  function injectBoosterPercent(): void {
    const have = doc.querySelector('.top > .have');
    if (!have) return;
    // Texte du site uniquement, sans notre propre ajout.
    const text = [...have.childNodes]
      .filter((n) => !(n.nodeType === 1 && (n as Element).classList.contains('bk-pct')))
      .map((n) => n.textContent)
      .join('');
    const value = ownedPercent(text);
    let pct = doc.querySelector('.top > .have > .bk-pct');
    if (value === null) {
      pct?.remove();
      return;
    }
    if (!pct) {
      pct = doc.createElement('span');
      pct.className = 'bk-pct';
      have.append(pct);
    }
    if (pct.textContent !== value) pct.textContent = value;
  }

  function tick(): void {
    syncRoute();
    scanMissing();
    injectRefreshButton();
    injectBackButton();
    injectBoosterPercent();
    void restorePending();
  }

  const observer = new view.MutationObserver(tick);
  tick();
  observer.observe(doc.body, { childList: true, subtree: true });

  return {
    stop(): void {
      observer.disconnect();
      peekObserver.disconnect();
      doc.removeEventListener('click', rememberFilters, true);
      mobile.removeEventListener?.('change', injectRefreshButton);
    },
  };
}
