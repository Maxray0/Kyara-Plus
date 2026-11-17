import { storage } from 'wxt/utils/storage';
import { AuthError, PassRequiredError } from '../api';
import { appendActivity } from './activity';
import { fetchPrices, getMarket, type Api, type Listing } from './market';
import { repriceListing, type LogKind } from './sell';
import { getSellSettings, type SellSettings } from './settings';

/**
 * Reprix automatique : « suivre la médiane ». Une annonce à prix fixe dont le prix
 * dépasse la cible (médiane moins x %) d'au moins la marge minimale est retirée puis
 * remise en vente au prix cible. Désactivé par défaut, avec plafond horaire, intervalle
 * minimal et journal : c'est une boucle d'écritures, elle doit rester rare et bornée.
 */

export interface RepriceSettings {
  /** Désactivé par défaut : aucune écriture sans activation explicite. */
  enabled: boolean;
  /** Baisse visée sous la médiane, en pourcentage (1 à 50). */
  underPct: number;
  /** Gain minimal en ◆ pour justifier une annulation + remise en vente. */
  minGain: number;
  /** Ajustements autorisés par heure. */
  maxPerHour: number;
  /** Minutes entre deux passes. */
  intervalMin: number;
}

export const REPRICE_DEFAULTS: Readonly<RepriceSettings> = {
  enabled: false,
  underPct: 5,
  minGain: 3,
  maxPerHour: 4,
  intervalMin: 15,
};

/** Intervalles proposés dans le panneau (minutes). */
export const REPRICE_INTERVALS_MIN = [5, 10, 15, 30, 60] as const;
/** Pause après un échec : jamais de réessai en rafale sur une boucle d'écritures. */
export const REPRICE_RETRY_MS = 5 * 60_000;
/** Fenêtre du plafond horaire. */
export const REPRICE_WINDOW_MS = 3600e3;
/** Ajustements conservés dans l'historique. */
const HISTORY_MAX = 40;

export interface RepriceState {
  /** Dernière passe tentée. */
  at: number;
  /** Horodatages des ajustements réussis (fenêtre d'une heure). */
  history: number[];
  /** Dernier échec, affiché tel quel. */
  lastError: string | null;
  /** Ajustements de la dernière passe. */
  lastCount: number;
  /** Pas de nouvelle tentative avant cette date. */
  retryAt: number;
}

export const repriceSettingsItem = storage.defineItem<RepriceSettings>('local:autoReprice', {
  fallback: { ...REPRICE_DEFAULTS },
  version: 1,
});

export const repriceStateItem = storage.defineItem<RepriceState>('local:autoRepriceState', {
  fallback: { at: 0, history: [], lastError: null, lastCount: 0, retryAt: 0 },
  version: 1,
});

const clamp = (value: unknown, min: number, max: number, fallback: number): number => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : fallback;
};

export function normalizeRepriceSettings(raw: unknown): RepriceSettings {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const d = REPRICE_DEFAULTS;
  return {
    enabled: source.enabled === true,
    underPct: clamp(source.underPct, 1, 50, d.underPct),
    minGain: clamp(source.minGain, 1, 10_000, d.minGain),
    maxPerHour: clamp(source.maxPerHour, 1, 12, d.maxPerHour),
    intervalMin: clamp(source.intervalMin, 5, 120, d.intervalMin),
  };
}

export function normalizeRepriceState(raw: unknown): RepriceState {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const at = Number(source.at);
  const retryAt = Number(source.retryAt);
  const lastCount = Number(source.lastCount);
  return {
    at: Number.isFinite(at) && at > 0 ? at : 0,
    history: Array.isArray(source.history)
      ? source.history
          .map((value) => Number(value))
          .filter((value) => Number.isFinite(value) && value > 0)
          .slice(-HISTORY_MAX)
      : [],
    lastError: typeof source.lastError === 'string' && source.lastError ? source.lastError : null,
    lastCount: Number.isFinite(lastCount) && lastCount > 0 ? Math.trunc(lastCount) : 0,
    retryAt: Number.isFinite(retryAt) && retryAt > 0 ? retryAt : 0,
  };
}

/** Prix visé : médiane moins la baisse réglée, jamais sous 1 ◆. */
export function repriceTarget(median: number | null | undefined, settings: RepriceSettings): number | null {
  if (!median || median <= 0) return null;
  const target = Math.round(median * (1 - settings.underPct / 100));
  return target >= 1 ? target : null;
}

export interface RepricePlan {
  listing: Listing;
  from: number;
  to: number;
  median: number;
}

/**
 * Annonces à ajuster : prix fixe, médiane connue, cible au moins `minGain` sous le prix
 * actuel (sinon l'annulation coûte plus qu'elle ne rapporte). Une enchère n'est jamais
 * touchée : elle se termine d'elle-même.
 */
export function planReprice(
  listings: readonly Listing[],
  medians: ReadonlyMap<number, number | null>,
  settings: RepriceSettings,
): RepricePlan[] {
  const plans: RepricePlan[] = [];
  for (const listing of listings) {
    if (listing.type === 'auction') continue;
    const median = medians.get(listing.characterId) ?? null;
    const to = repriceTarget(median, settings);
    if (!median || to === null) continue;
    const from = Number(listing.price);
    if (!Number.isFinite(from) || from <= 0) continue;
    if (to >= from - Math.max(1, settings.minGain)) continue;
    plans.push({ listing, from, to, median });
  }
  // La plus grosse marge d'abord : c'est là que l'emplacement rapporte le plus.
  return plans.sort((a, b) => b.from - b.to - (a.from - a.to));
}

/** Ajustements encore autorisés dans l'heure. */
export function repriceBudget(state: RepriceState, settings: RepriceSettings, now = Date.now()): number {
  const recent = state.history.filter((at) => now - at < REPRICE_WINDOW_MS).length;
  return Math.max(0, settings.maxPerHour - recent);
}

export const REPRICE_HREF = 'https://kyara.games/vente';

export interface RepriceRunOptions {
  api: Api;
  settings?: RepriceSettings;
  state?: RepriceState;
  sellSettings?: SellSettings;
  now?: number;
  /** Ignore la cadence (bouton « Ajuster maintenant »). */
  force?: boolean;
  saveSettings?: (next: RepriceSettings) => Promise<void>;
  saveState?: (next: RepriceState) => Promise<void>;
  /** Prix lus pour chaque annonce ; injectable pour les tests. */
  loadMedian?: (listing: Listing) => Promise<number | null>;
  log?: (message: string, kind?: LogKind) => void;
  wait?: (ms: number) => Promise<void>;
}

export interface RepriceRun {
  ok: boolean;
  skipped: 'disabled' | 'waiting' | 'quota' | null;
  adjusted: number;
  listings: number;
  error: string | null;
  at: number;
}

/**
 * Une passe bornée : au plus `maxPerHour` ajustements réussis dans l'heure, un échec
 * du site met la boucle en pause. Les prix sont relus avant chaque annulation, car la
 * médiane peut avoir bougé depuis la dernière passe.
 */
export async function runReprice(options: RepriceRunOptions): Promise<RepriceRun> {
  const now = options.now ?? Date.now();
  const settings = normalizeRepriceSettings(
    options.settings ??
      (await (async () => {
        try {
          return await repriceSettingsItem.getValue();
        } catch {
          return null;
        }
      })()),
  );
  const state = normalizeRepriceState(
    options.state ??
      (await (async () => {
        try {
          return await repriceStateItem.getValue();
        } catch {
          return null;
        }
      })()),
  );
  const saveState =
    options.saveState ?? ((next: RepriceState) => repriceStateItem.setValue(next));
  const log = options.log ?? ((message: string, kind?: LogKind) => void appendActivity(message, kind));
  const base = { adjusted: 0, listings: 0, error: null, at: state.at };

  if (!settings.enabled) return { ...base, ok: false, skipped: 'disabled' };
  const dueAt = state.at > 0 ? Math.max(state.at + settings.intervalMin * 60_000, state.retryAt) : state.retryAt;
  if (!options.force && now < dueAt) return { ...base, ok: false, skipped: 'waiting' };
  const budget = repriceBudget(state, settings, now);
  if (!budget) return { ...base, ok: false, skipped: 'quota' };

  try {
    const { active } = await getMarket(options.api);
    const fixed = active.filter((listing) => listing.type !== 'auction');
    const medians = new Map<number, number | null>();
    for (const listing of fixed) {
      if (medians.has(listing.characterId)) continue;
      try {
        if (options.loadMedian) medians.set(listing.characterId, await options.loadMedian(listing));
        else {
          const prices = await fetchPrices(options.api, listing.characterId);
          medians.set(listing.characterId, prices.median7d ?? prices.median30d ?? null);
        }
      } catch (error) {
        if (error instanceof AuthError || error instanceof PassRequiredError) throw error;
        medians.set(listing.characterId, null);
      }
    }
    const plans = planReprice(fixed, medians, settings).slice(0, budget);
    const sellSettings = options.sellSettings ?? (await getSellSettings());
    const wait = options.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    let adjusted = 0;
    let failed = 0;
    const stamps: number[] = [];
    for (const plan of plans) {
      const name = plan.listing.name ?? `Carte #${plan.listing.characterId}`;
      const result = await repriceListing(options.api, plan.listing, plan.to, sellSettings, {
        gapMs: 0,
        sleep: wait,
        log: (message, kind) => log(message, kind),
      });
      if (result.listed) {
        adjusted += 1;
        stamps.push(now);
        log(`${name} : annonce ajustée de ${plan.from} à ${plan.to} ◆.`, 'sale');
      } else {
        failed += 1;
        log(`${name} : ajustement refusé (${result.message || 'refus de Kyara'}).`, 'warn');
        if (result.cancelled) {
          // L'ancienne annonce est déjà retirée : on s'arrête au lieu d'enchaîner.
          break;
        }
      }
    }
    const history = [...state.history, ...stamps]
      .filter((at) => now - at < REPRICE_WINDOW_MS)
      .slice(-HISTORY_MAX);
    await saveState({
      at: now,
      history,
      lastError: failed ? `${failed} ajustement(s) refusé(s)` : null,
      lastCount: adjusted,
      retryAt: 0,
    });
    return { ok: true, skipped: null, adjusted, listings: active.length, error: null, at: now };
  } catch (error) {
    if (error instanceof AuthError || error instanceof PassRequiredError) throw error;
    const message = error instanceof Error ? error.message : 'Ajustement impossible';
    const retryAt = now + Math.max(REPRICE_RETRY_MS, settings.intervalMin * 60_000);
    await saveState({ ...state, at: state.at, lastError: message, retryAt }).catch(() => undefined);
    return { ok: false, skipped: null, adjusted: 0, listings: 0, error: message, at: state.at };
  }
}

export interface RepriceLoopOptions {
  api: Api;
  document: Document;
  now?: () => number;
  /** Passe injectée, pour les tests. */
  run?: (options: RepriceRunOptions) => Promise<RepriceRun> | RepriceRun;
  /** Cadence des contrôles : la passe elle-même respecte `intervalMin`. */
  tickMs?: number;
}

export interface RepriceLoop {
  tick(): Promise<RepriceRun | null>;
  stop(): void;
}

/**
 * Boucle de reprix : un contrôle par minute, jamais dans un onglet masqué, et une passe
 * seulement quand l'intervalle réglé est écoulé. Elle ne fait rien tant que le mode
 * n'est pas activé explicitement dans le panneau.
 */
export function startRepriceLoop(options: RepriceLoopOptions): RepriceLoop {
  const now = options.now ?? Date.now;
  const tickMs = options.tickMs ?? 60_000;
  const run = options.run ?? runReprice;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let busy = false;

  const tick = async (): Promise<RepriceRun | null> => {
    if (stopped || busy) return null;
    if (options.document.visibilityState !== 'visible') return null;
    busy = true;
    try {
      return await run({ api: options.api, now: now() });
    } finally {
      busy = false;
    }
  };

  const schedule = (): void => {
    timer = setTimeout(() => {
      void tick().then(
        () => {
          if (!stopped) schedule();
        },
        () => {
          if (!stopped) schedule();
        },
      );
    }, tickMs);
  };
  schedule();
  void tick();

  return {
    tick,
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
