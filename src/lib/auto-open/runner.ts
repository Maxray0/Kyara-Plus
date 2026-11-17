import { ApiError, AuthError, PassRequiredError, RateLimitedError, type ApiClient } from '../api';
import type { Settings } from '../settings';
import {
  applyCost,
  delayRange,
  mergeUser,
  nextCost,
  nextDelayMs,
  normalizePackState,
  normalizePacks,
  pickPack,
  stoppedText,
  toAccount,
  type PackInfo,
  type PackState,
} from './planner';

import type { StopReason } from '../supervisor';

export type { StopReason };

export interface AutoOpenStatus {
  state: 'running' | 'waiting' | 'paused' | 'stopped';
  message: string;
  opened: number;
  cards: number;
  spent: number;
  /** Prochaine ouverture prévue (ms), sinon null. */
  nextAt: number | null;
  updatedAt: number;
}

export interface AutoOpenDeps {
  api: Pick<ApiClient, 'request'>;
  getSettings: () => Promise<Settings>;
  /** Doit se terminer tout de suite quand le signal est annulé. */
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  now: () => number;
  random: () => number;
  log: (message: string) => void;
  report: (status: AutoOpenStatus) => void;
  onCatalog?: (packs: PackInfo[]) => void;
}

/** Attente réglée dans l'interface, bornée : 5 s à 5 min. */
function idleWait(settings: Settings): number {
  return Math.max(5_000, Math.min(IDLE_MAX_MS, Math.round(settings.autoOpenIdleSec * 1000)));
}
const IDLE_MAX_MS = 5 * 60_000;
const SYNC_MAX_AGE_MS = 45_000;
const ERROR_WAIT_MS = 60_000;
const MAX_RATE_PAUSE_MS = 10 * 60_000;

function errorCode(error: unknown): string | null {
  return error instanceof ApiError ? error.code : null;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : 'erreur inconnue';
}

/**
 * Boucle d'ouverture automatique. Elle ne dépense du chakra que si le réglage l'autorise,
 * s'arrête sur `pass_required` (vérification à faire à la main sur le site) et sur 401.
 */
export async function runAutoOpen(deps: AutoOpenDeps, signal: AbortSignal): Promise<StopReason> {
  const totals = { opened: 0, cards: 0, spent: 0 };
  let user: Record<string, unknown> = {};
  let packState: PackState = { grants: {}, limitsLeft: {} };
  let catalog: PackInfo[] = [];
  let lastSync = Number.NEGATIVE_INFINITY;
  let rateHits = 0;
  let idleStep = 0;
  let idleReason = '';

  const alive = () => !signal.aborted;
  const sleep = (ms: number) => deps.sleep(ms, signal);
  const report = (state: AutoOpenStatus['state'], message: string, nextAt: number | null = null) =>
    deps.report({ state, message, ...totals, nextAt, updatedAt: deps.now() });

  /** Les erreurs d'authentification et de vérification remontent ; le reste est toléré. */
  async function tolerate<T>(task: () => Promise<T>): Promise<T | null> {
    try {
      return await task();
    } catch (error) {
      if (error instanceof AuthError || error instanceof PassRequiredError) throw error;
      return null;
    }
  }

  async function sync(withCatalog: boolean): Promise<void> {
    const me = await tolerate(() => deps.api.request<unknown>('/api/me', { timeoutMs: 15_000 }));
    if (me) user = mergeUser(user, me);
    const state = await tolerate(() => deps.api.request<unknown>('/api/me/packs'));
    if (state) packState = normalizePackState(state);
    if (withCatalog || !catalog.length) {
      const packs = await tolerate(() =>
        deps.api.request<unknown>('/api/packs', { timeoutMs: 25_000 }),
      );
      if (packs) {
        catalog = normalizePacks(packs);
        deps.onCatalog?.(catalog);
      }
    }
    lastSync = deps.now();
  }

  async function step(settings: Settings): Promise<void> {
    if (deps.now() - lastSync > SYNC_MAX_AGE_MS) await sync(false);
    if (!alive()) return;
    const idle = idleWait(settings);

    const selected = catalog.filter(
      (pack) => settings.autoOpenPackIds.includes(pack.id) && !pack.grantOnly,
    );
    if (!selected.length) {
      report('waiting', 'En attente : aucun booster sélectionné');
      await sleep(idle);
      lastSync = Number.NEGATIVE_INFINITY;
      return;
    }

    const allowChakra = settings.autoOpenAllowChakra;
    const account = toAccount(user);
    const pack = pickPack(selected, account, packState, allowChakra, deps.random);
    if (!pack) {
      idleStep = Math.min(idleStep + 1, 5);
      const wait = Math.min(IDLE_MAX_MS, idle * idleStep);
      const reason = `offerts ${account.freePacks + account.bonusPacks} · chakra ${account.chakra}`;
      report('waiting', `En attente de boosters (${reason}) · ${totals.opened} ouvert(s)`);
      if (reason !== idleReason) {
        idleReason = reason;
        deps.log(`en attente : ${reason}${allowChakra ? '' : ' (chakra non autorisé)'}`);
      }
      await sleep(wait);
      lastSync = Number.NEGATIVE_INFINITY;
      return;
    }

    const cost = nextCost(pack, account, packState, allowChakra);
    report('running', `Ouverture de ${pack.name}…`);
    const data = await deps.api.request<unknown>(
      `/api/packs/${encodeURIComponent(pack.id)}/open-many`,
      {
        method: 'POST',
        body: { count: 1, maxChakra: cost.chakra },
        timeoutMs: 45_000,
      },
    );

    const response = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
    const results = Array.isArray(response.results) ? response.results : [];
    if (!results.length) {
      const why = response.stopped ? stoppedText(response.stopped) : 'réponse vide';
      report('waiting', `En attente : ${why} · ${totals.opened} ouvert(s)`);
      deps.log(`aucune carte renvoyée (${why})`);
      await sleep(idle);
      lastSync = Number.NEGATIVE_INFINITY;
      return;
    }

    let pulled = 0;
    for (const result of results) {
      const cards = (result as { cards?: unknown } | null)?.cards;
      if (Array.isArray(cards)) pulled += cards.length;
    }
    totals.opened += results.length;
    totals.cards += pulled;
    totals.spent += cost.chakra;
    const applied = applyCost(pack, cost, account, packState);
    packState = applied.state;
    user = {
      ...user,
      chakra: applied.account.chakra,
      freePacks: applied.account.freePacks,
      bonusPacks: applied.account.bonusPacks,
    };
    user = mergeUser(user, response.user);
    rateHits = 0;
    idleStep = 0;
    deps.log(`ouvert ${pack.name} → ${pulled} carte(s)`);

    if (response.stopped) {
      const why = stoppedText(response.stopped);
      report('waiting', `En attente : ${why} · ${totals.opened} ouvert(s)`);
      deps.log(`serveur : ${why} — attente`);
      await sleep(idle);
      lastSync = Number.NEGATIVE_INFINITY;
      return;
    }

    const range = delayRange(toAccount(user), deps.now());
    const delay = nextDelayMs(range, deps.random);
    if (delay === 0) {
      report('running', `Ouverture… ${totals.opened} · jauge pleine : ouverture immédiate`);
      return;
    }
    const minutes = Math.round(delay / 60_000);
    deps.log(`délai ${minutes} min (T_max ${range.maxMin} min)`);
    report('waiting', `Prochaine ouverture dans ${minutes} min`, deps.now() + delay);
    await sleep(delay);
  }

  deps.log('auto-open démarré');
  while (alive()) {
    const settings = await deps.getSettings();
    if (!settings.autoOpen) {
      report('stopped', 'Désactivé');
      return 'disabled';
    }
    try {
      await step(settings);
    } catch (error) {
      if (error instanceof AuthError) {
        deps.log('session expirée : auto-open en pause');
        report('paused', 'Session expirée : ouvre kyara.games pour reprendre.');
        return 'auth';
      }
      if (error instanceof PassRequiredError || errorCode(error) === 'pass_required') {
        deps.log('vérification demandée : auto-open en pause');
        report(
          'paused',
          'Vérification demandée par le site : ouvre un booster à la main sur kyara.games, puis réactive.',
        );
        return 'pass_required';
      }
      const code = errorCode(error);
      if (code === 'insufficient_chakra' || code === 'no_funds') {
        deps.log('chakra insuffisant : attente');
        report('waiting', `En attente de chakra… ${totals.opened} ouvert(s)`);
        await sleep(idleWait(settings));
        lastSync = Number.NEGATIVE_INFINITY;
      } else if (error instanceof RateLimitedError) {
        rateHits = Math.min(rateHits + 1, 5);
        const wait = Math.min(MAX_RATE_PAUSE_MS, 4_000 * 2 ** rateHits);
        deps.log(`limite de requêtes (${rateHits}) : pause ${Math.round(wait / 1000)} s`);
        report('waiting', `Trop de requêtes : pause ${Math.round(wait / 1000)} s`);
        await sleep(wait);
      } else {
        deps.log(`erreur : ${describe(error)}`);
        report('waiting', `Erreur : ${describe(error)} · nouvelle tentative dans 1 min`);
        await sleep(ERROR_WAIT_MS);
      }
    }
  }
  report('stopped', `Arrêté : ${totals.opened} booster(s), ${totals.cards} carte(s)`);
  return 'aborted';
}
