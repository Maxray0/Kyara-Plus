import { storage } from 'wxt/utils/storage';
import type { Alert } from '../alerts/model';
import { offerAlertHref } from '../alerts/sources';
import { upsertAlerts } from '../alerts/store';
import { call, type Api } from '../doublons/market';
import {
  isOffersPayload,
  myIdFromOffers,
  normalizeOffers,
  type TradeOffer,
} from '../doublons/trades';
import type { CardsExtra } from './cards';
import { cardImageId, characterId, isOffersPage, normalizeCharacter } from './prices';

/**
 * Veille de cartes : un bouton local sur chaque carte proposée à l'échange, et une
 * alerte quand une carte suivie réapparaît dans le comptoir.
 *
 * Tout reste local : aucune envie n'est ajoutée sur le site, aucune notification
 * système n'est créée. La veille ne lit le comptoir que sur `/marche?onglet=offres`,
 * onglet visible, et seulement si au moins une carte est suivie.
 */

/** Cartes suivies, conservées dans `storage.local` (jamais une donnée de compte). */
export const watchedCardsItem = storage.defineItem<number[]>('local:watchedCards', {
  fallback: [],
  version: 1,
});

/** Classe du bouton posé sur chaque carte proposée. */
export const WATCH_BUTTON_CLASS = 'kyaraext-watch-button';
/** Classe du panneau qui liste les cartes suivies, sous les filtres du comptoir. */
export const WATCH_PANEL_CLASS = 'kyaraext-watch-list';
/** Nombre maximal de cartes suivies. */
export const WATCH_MAX = 60;
/** Intervalle entre deux lectures du comptoir, comme la veille du legacy. */
export const WATCH_INTERVAL_MS = 30_000;
/** Durée de validité de mon identifiant, pour ne pas le relire à chaque passage. */
const MY_ID_TTL = 10 * 60_000;
/** Relecture plus rapide quand l'identifiant n'a pas pu être trouvé. */
const MY_ID_UNKNOWN_TTL = 60_000;
/** Après un échec de lecture du nom, on attend avant de redemander. */
const NAME_ERROR_TTL = 10 * 60_000;
/** Noms résolus au maximum par passage, pour ne pas lancer une rafale de lectures. */
const NAME_BATCH_MAX = 10;
/** Passes de résolution quand le panneau de revue est déplié (60 cartes au plus). */
const PANEL_NAME_ROUNDS = 2;

/** Nettoie une liste relue du stockage : identifiants entiers positifs, sans doublon. */
export function cleanWatched(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const ids: number[] = [];
  for (const value of raw) {
    const id = Number(value);
    if (!Number.isSafeInteger(id) || id < 1 || ids.includes(id)) continue;
    ids.push(id);
    if (ids.length >= WATCH_MAX) break;
  }
  return ids;
}

/** Ajoute ou retire une carte suivie ; une liste pleine n'accepte rien de plus. */
export function toggleWatched(ids: readonly number[], id: number): number[] {
  const current = cleanWatched(ids);
  if (!Number.isSafeInteger(id) || id < 1) return current;
  if (current.includes(id)) return current.filter((entry) => entry !== id);
  if (current.length >= WATCH_MAX) return current;
  return [...current, id];
}

function eventAt(value: string | null, now: number): number {
  const time = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(time) && time > 0 ? Math.min(time, now) : now;
}

/** Une offre fermée ou expirée ne mérite pas d'alerte. */
function watchableOffer(offer: TradeOffer, now: number): boolean {
  if (offer.status && offer.status !== 'open') return false;
  const expires = offer.expiresAt ? Date.parse(offer.expiresAt) : Number.NaN;
  return !(Number.isFinite(expires) && expires < now);
}

/**
 * Transforme une lecture du comptoir en alertes de veille : une alerte par offre
 * ouverte dont la carte proposée est suivie. La clé déduplique les lectures répétées.
 * Mes propres offres sont ignorées dès que mon identifiant est connu.
 */
export function watchAlerts(
  offers: readonly TradeOffer[],
  watched: ReadonlySet<number>,
  cardName: (id: number) => string | null,
  now = Date.now(),
  myId: string | null = null,
): Alert[] {
  if (!watched.size) return [];
  const alerts: Alert[] = [];
  for (const offer of offers) {
    if (!watched.has(offer.characterId) || !watchableOffer(offer, now)) continue;
    if (myId && (offer.userId === myId || offer.takerId === myId)) continue;
    const name = cardName(offer.characterId) ?? `Carte #${offer.characterId}`;
    alerts.push({
      key: `market:offer:${offer.id}`,
      kind: 'market',
      title: `${name} est proposée en échange`,
      message: `${offer.userPseudo ?? 'Un joueur'} · veille locale`,
      at: eventAt(offer.createdAt, now),
      read: false,
      href: offerAlertHref(offer.id),
    });
  }
  return alerts;
}

export interface CardWatchOptions {
  document: Document;
  location: { href: string };
  /** Client API du content script ; sans lui, aucune lecture réseau n'est faite. */
  api?: Api;
  /** Lecture du comptoir, injectable pour les tests. */
  loadOffers?: () => Promise<readonly TradeOffer[]>;
  /** Nom de la carte, lu dans le cache de prix du site quand il est disponible. */
  cardName?: (id: number) => string | null;
  /** Nom lu à la source (`/api/characters/{id}`) quand le cache du site l'ignore. */
  loadName?: (id: number) => Promise<string | null>;
  /** Mon identifiant de joueur, pour ne pas s'alerter de ses propres offres. */
  loadMyId?: () => Promise<string | null>;
  loadWatched?: () => Promise<number[]>;
  saveWatched?: (ids: number[]) => Promise<void>;
  record?: (alerts: Alert[], now: number) => Promise<unknown>;
  now?: () => number;
  setTimer?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
  intervalMs?: number;
}

export interface CardWatch extends CardsExtra {
  /** Une lecture du comptoir, sans attendre la minuterie. */
  check(): Promise<void>;
}

/**
 * Module branché sur le contrôleur de cartes : il décore les lignes du comptoir et
 * enregistre les alertes de veille dans la cloche locale.
 */
export function createCardWatch(options: CardWatchOptions): CardWatch {
  const doc = options.document;
  const location = options.location;
  const now = options.now ?? Date.now;
  const setTimer =
    options.setTimer ?? ((callback: () => void, delay: number) => setTimeout(callback, delay));
  const clearTimer =
    options.clearTimer ?? ((timer: ReturnType<typeof setTimeout>) => clearTimeout(timer));
  const intervalMs = options.intervalMs ?? WATCH_INTERVAL_MS;
  const cardName = options.cardName ?? (() => null);
  const loadWatched =
    options.loadWatched ?? (() => watchedCardsItem.getValue().then((ids) => cleanWatched(ids)));
  const saveWatched =
    options.saveWatched ?? ((ids: number[]) => watchedCardsItem.setValue(ids));
  const record = options.record ?? ((alerts: Alert[], at: number) => upsertAlerts(alerts, at));
  const loadName =
    options.loadName ??
    (async (id: number): Promise<string | null> => {
      if (!options.api) return null;
      const result = await call(options.api, `/api/characters/${id}`);
      return result.ok ? normalizeCharacter(result.data, id).name : null;
    });
  const loadMyId =
    options.loadMyId ??
    (async (): Promise<string | null> => {
      if (!options.api) return null;
      const result = await call(options.api, '/api/trades/offers/mine');
      return result.ok ? myIdFromOffers(result.data) : null;
    });
  const loadOffers =
    options.loadOffers ??
    (async (): Promise<readonly TradeOffer[]> => {
      if (!options.api) return [];
      const result = await call(options.api, '/api/trades/offers');
      if (!result.ok) throw new Error(`Comptoir : ${result.message}`);
      if (!isOffersPayload(result.data)) throw new Error('Format du comptoir inattendu');
      return normalizeOffers(result.data);
    });

  let watched: Set<number> | null = null;
  let pulseTimer: ReturnType<typeof setTimeout> | null = null;
  let checking = false;
  let destroyed = false;
  let myId: string | null = null;
  let myIdResolvedAt = 0;
  let myIdPending: Promise<string | null> | null = null;
  /** Noms déjà résolus par l'API des personnages, gardés pour la vie de la page. */
  const names = new Map<number, string>();
  const nameRetryAt = new Map<number, number>();
  let panel: HTMLElement | null = null;
  let panelSignature = '';
  let panelExpanded = false;
  /** Motif du dernier échec de pulsation, affiché dans le panneau jusqu'à la suivante. */
  let lastError: string | null = null;
  // Une lecture tardive du stockage ne doit pas écraser un choix déjà fait.
  let changedByUser = false;

  function paint(): void {
    for (const button of doc.querySelectorAll<HTMLButtonElement>(`.${WATCH_BUTTON_CLASS}`)) {
      const id = Number(button.dataset.watchId);
      button.setAttribute('aria-pressed', String(watched?.has(id) === true));
    }
  }

  async function toggle(id: number): Promise<void> {
    if (destroyed) return;
    changedByUser = true;
    const next = toggleWatched([...(watched ?? [])], id);
    watched = new Set(next);
    paint();
    try {
      await saveWatched(next);
    } catch {
      // Stockage indisponible : le bouton reste à son nouvel état pour cette page.
    }
    renderPanel();
    if (next.length) void check();
  }

  function createButton(id: number): HTMLButtonElement {
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = WATCH_BUTTON_CLASS;
    button.dataset.watchId = String(id);
    button.textContent = 'Veille';
    button.title =
      'Suivre cette carte : une alerte locale apparaîtra dès qu’elle sera proposée en échange.';
    button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', () => void toggle(id));
    return button;
  }

  function clearButtons(): void {
    for (const button of doc.querySelectorAll(`.${WATCH_BUTTON_CLASS}`)) button.remove();
  }

  function decorate(): void {
    for (const row of doc.querySelectorAll('.offers .offer')) {
      const anchor = row.querySelector('.give a.big');
      const id =
        characterId(anchor?.getAttribute('href') ?? null) ??
        cardImageId(row.querySelector('.give img')?.getAttribute('src') ?? null);
      const host = row.querySelector('.give .gi');
      if (!id || !host) continue;
      const existing = [...host.children].find((child) =>
        child.classList.contains(WATCH_BUTTON_CLASS),
      ) as HTMLButtonElement | undefined;
      if (existing) {
        existing.dataset.watchId = String(id);
        continue;
      }
      host.append(createButton(id));
    }
    paint();
  }

  async function resolveMyId(): Promise<string | null> {
    const at = now();
    const ttl = myId ? MY_ID_TTL : MY_ID_UNKNOWN_TTL;
    // Un identifiant déjà trouvé reste valable ; un échec est retenté plus tard.
    if (myIdResolvedAt && at - myIdResolvedAt < ttl) return myId;
    myIdPending ??= Promise.resolve()
      .then(loadMyId)
      .then((id) => {
        myId = id ?? null;
        myIdResolvedAt = now();
        return myId;
      })
      .catch(() => {
        myIdResolvedAt = now();
        return myId;
      })
      .finally(() => {
        myIdPending = null;
      });
    return myIdPending;
  }

  /** Nom connu d'une carte : cache de prix du site, puis nom déjà résolu. */
  const knownName = (id: number): string | null => cardName(id) ?? names.get(id) ?? null;

  /** Résout au plus `NAME_BATCH_MAX` noms manquants ; true si un nom est arrivé. */
  async function ensureNames(ids: Iterable<number>): Promise<boolean> {
    const wanted: number[] = [];
    for (const id of ids) {
      if (knownName(id) || (nameRetryAt.get(id) ?? 0) > now() || wanted.includes(id)) continue;
      wanted.push(id);
      if (wanted.length >= NAME_BATCH_MAX) break;
    }
    let resolved = false;
    for (const id of wanted) {
      if (destroyed) return resolved;
      try {
        const name = (await loadName(id))?.trim();
        if (name) {
          names.set(id, name);
          resolved = true;
        } else {
          nameRetryAt.set(id, now() + NAME_ERROR_TTL);
        }
      } catch {
        nameRetryAt.set(id, now() + NAME_ERROR_TTL);
      }
    }
    return resolved;
  }

  /**
   * Résout les noms des cartes suivies réellement proposées dans cette lecture,
   * plutôt que d'interroger l'API pour des cartes sans offre ouverte.
   */
  async function resolveOffersNames(
    offers: readonly TradeOffer[],
    followed: ReadonlySet<number>,
    mine: string | null,
  ): Promise<void> {
    const offered: number[] = [];
    for (const offer of offers) {
      const id = offer.characterId;
      if (!followed.has(id) || !watchableOffer(offer, now())) continue;
      if (mine && (offer.userId === mine || offer.takerId === mine)) continue;
      if (!offered.includes(id)) offered.push(id);
      if (offered.length >= NAME_BATCH_MAX) break;
    }
    await ensureNames(offered);
  }

  /** Complète les noms du panneau déplié, par passes bornées. */
  async function fillPanelNames(ids: readonly number[]): Promise<void> {
    for (let round = 0; round < PANEL_NAME_ROUNDS; round += 1) {
      const resolved = await ensureNames(ids);
      if (!resolved || destroyed) return;
      renderPanel();
    }
  }

  /**
   * Panneau « Veille · n » sous les filtres du comptoir : compte les cartes suivies,
   * les liste une fois déplié et permet de les retirer sans retrouver leur offre.
   */
  function renderPanel(): void {
    const ids = [...(watched ?? [])];
    const filters = isOffersPage(location.href) ? doc.querySelector('.board .filters') : null;
    if (destroyed || !filters || !ids.length) {
      panel?.remove();
      panel = null;
      panelSignature = '';
      return;
    }
    const signature = `${ids.join(',')}|${panelExpanded}|${lastError ?? ''}|${ids
      .map((id) => knownName(id) ?? '')
      .join(',')}`;
    if (signature === panelSignature && panel?.isConnected) return;
    panelSignature = signature;

    // Le panneau est reconstruit : sans cela, déplier ou retirer une carte
    // renverrait le focus au document. On retient où il était pour le rendre.
    const active = doc.activeElement;
    const insidePanel = !!panel && !!active && panel.contains(active);
    const wasSummary = insidePanel && active?.classList.contains('kyaraext-watch-summary') === true;
    const removeButtons = [...(panel?.querySelectorAll<HTMLElement>('.kyaraext-watch-remove') ?? [])];
    const activeRemove = active instanceof HTMLElement ? removeButtons.indexOf(active) : -1;
    const activeWatchId = active instanceof HTMLElement ? (active.dataset.watchId ?? null) : null;

    const section = doc.createElement('section');
    section.className = WATCH_PANEL_CLASS;
    section.setAttribute('aria-label', 'Cartes suivies');

    const summary = doc.createElement('button');
    summary.type = 'button';
    summary.className = 'kyaraext-watch-summary';
    summary.setAttribute('aria-expanded', String(panelExpanded));
    summary.textContent = `Veille · ${ids.length}`;
    summary.addEventListener('click', () => {
      panelExpanded = !panelExpanded;
      renderPanel();
      if (panelExpanded) void fillPanelNames(ids);
    });
    section.append(summary);

    if (lastError) {
      const status = doc.createElement('p');
      status.className = 'kyaraext-watch-status';
      status.setAttribute('role', 'status');
      status.textContent = `Dernière relecture en échec : ${lastError}`;
      section.append(status);
    }

    if (panelExpanded) {
      const list = doc.createElement('ul');
      list.className = 'kyaraext-watch-items';
      for (const id of ids) {
        const item = doc.createElement('li');
        const link = doc.createElement('a');
        link.href = `/wiki/${id}`;
        link.textContent = knownName(id) ?? `Carte #${id}`;
        const remove = doc.createElement('button');
        remove.type = 'button';
        remove.className = 'kyaraext-watch-remove';
        remove.dataset.watchId = String(id);
        remove.setAttribute('aria-label', `Ne plus suivre ${link.textContent}`);
        remove.title = 'Ne plus suivre cette carte';
        remove.textContent = '×';
        remove.addEventListener('click', () => void untoggle(id));
        item.append(link, remove);
        list.append(item);
      }
      section.append(list);
    }

    if (panel?.isConnected) panel.replaceWith(section);
    else filters.after(section);
    panel = section;

    if (insidePanel) {
      const summary = section.querySelector<HTMLElement>('.kyaraext-watch-summary');
      const nextRemoves = [...section.querySelectorAll<HTMLElement>('.kyaraext-watch-remove')];
      const kept = activeWatchId
        ? nextRemoves.find((button) => button.dataset.watchId === activeWatchId)
        : undefined;
      // Carte retirée : le focus glisse vers le bouton suivant (ou précédent), sinon
      // vers la synthèse. Sinon il revient sur l'élément équivalent reconstruit.
      const fallback =
        nextRemoves[Math.min(Math.max(activeRemove, 0), nextRemoves.length - 1)] ?? summary;
      (wasSummary ? summary : (kept ?? fallback))?.focus({ preventScroll: true });
    }
  }

  /** Retire une carte suivie depuis le panneau, sans relire le comptoir. */
  async function untoggle(id: number): Promise<void> {
    if (destroyed) return;
    changedByUser = true;
    const next = toggleWatched([...(watched ?? [])], id);
    watched = new Set(next);
    paint();
    renderPanel();
    try {
      await saveWatched(next);
    } catch {
      // Stockage indisponible : le retrait vaut pour cette page seulement.
    }
  }

  async function check(): Promise<void> {
    if (destroyed || checking) return;
    // Aucune lecture hors de la page des offres ni dans un onglet masqué.
    if (!isOffersPage(location.href) || doc.visibilityState !== 'visible') return;
    checking = true;
    try {
      // Une lecture lancée avant le chargement du stockage ne doit rien manquer.
      await ready;
      if (destroyed || !watched?.size) return;
      const [offers, mine] = await Promise.all([loadOffers(), resolveMyId()]);
      if (destroyed) return;
      await resolveOffersNames(offers, watched, mine);
      if (destroyed) return;
      const alerts = watchAlerts(offers, watched, knownName, now(), mine);
      if (alerts.length) await record(alerts, now());
      lastError = null;
    } catch (error) {
      // Session expirée, anti-robot ou réseau indisponible : la veille réessaiera,
      // mais l'échec reste visible dans le panneau et dans la console.
      lastError = error instanceof Error ? error.message : String(error);
      console.warn('[Kyara Plus] veille de cartes indisponible :', error);
    } finally {
      checking = false;
      renderPanel();
    }
  }

  function schedule(): void {
    if (pulseTimer || destroyed || !isOffersPage(location.href)) return;
    pulseTimer = setTimer(() => {
      pulseTimer = null;
      void check().finally(schedule);
    }, intervalMs);
  }

  function scan(): void {
    if (destroyed) return;
    if (!isOffersPage(location.href)) {
      clearButtons();
      renderPanel();
      return;
    }
    decorate();
    schedule();
    renderPanel();
  }

  const ready: Promise<void> = Promise.resolve()
    .then(loadWatched)
    .then((ids) => {
      if (destroyed || changedByUser) return;
      watched = new Set(cleanWatched(ids));
      paint();
      renderPanel();
    })
    .catch(() => {
      // Sans liste lisible, les boutons restent utilisables ; le stockage sera relu.
    });

  return {
    scan,
    check,
    destroy(): void {
      destroyed = true;
      if (pulseTimer) clearTimer(pulseTimer);
      pulseTimer = null;
      clearButtons();
      panel?.remove();
      panel = null;
    },
  };
}
