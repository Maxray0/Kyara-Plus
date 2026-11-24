import { storage } from 'wxt/utils/storage';
import { AuthError, PassRequiredError } from '../api';
import { isCircuitFailure } from '../circuit-breaker';
import { appendActivity } from './activity';
import type { StopReason } from '../supervisor';
import { buildCandidates, type CardMeta } from './candidates';
import { ShapeError, getMarket, hasShapeChanges, type Api, type StoredPrice } from './market';
import { listedCounts, sellNext, type LogKind } from './sell';
import { autoRarityOf, autoSellAllowed, type SellSettings } from './settings';

export interface AutoSellStatus {
  state: 'running' | 'waiting' | 'paused' | 'stopped';
  message: string;
  /** Annonces mises en vente depuis le démarrage de la boucle. */
  placed: number;
  /** Annonces actives lors du dernier passage. */
  active: number | null;
  nextAt: number | null;
  updatedAt: number;
}

export const autoSellStatusItem = storage.defineItem<AutoSellStatus | null>(
  'local:autoSellStatus',
  {
    fallback: null,
  },
);

export const autoSellLogItem = storage.defineItem<{ t: number; m: string; k: LogKind }[]>(
  'local:autoSellLog',
  { fallback: [] },
);

const LOG_MAX = 100;
let logChain: Promise<unknown> = Promise.resolve();

export function appendAutoSellLog(
  message: string,
  kind: LogKind = 'info',
  now = Date.now(),
): Promise<void> {
  logChain = logChain
    .then(async () => {
      // Le journal de la page Activité garde aussi les messages de la vente automatique.
      await appendActivity(message, kind, now);
      const list = await autoSellLogItem.getValue();
      await autoSellLogItem.setValue([...list, { t: now, m: message, k: kind }].slice(-LOG_MAX));
    })
    .catch(() => undefined);
  return logChain as Promise<void>;
}

export interface AutoSellDeps {
  api: Api;
  isEnabled: () => Promise<boolean>;
  getSettings: () => Promise<SellSettings>;
  /** Noms et raretés connus (catalogue déjà en cache) ; sert aux journaux et au tri. */
  getMeta: () => Promise<ReadonlyMap<number, Partial<CardMeta>>>;
  getPrices: () => Promise<ReadonlyMap<number, StoredPrice>>;
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  now: () => number;
  log: (message: string, kind?: LogKind) => void;
  report: (status: AutoSellStatus) => void;
  /** Échec technique d'un passage : le coupe-circuit compte les échecs consécutifs. */
  onFailure?: (reason: string) => void | Promise<void>;
  /** Passage terminé sans erreur : la série d'échecs est terminée. */
  onSuccess?: () => void | Promise<void>;
}

/** Heures égales : la vente automatique tourne toute la journée. */
export function inAutoWindow(hour: number, from: number, to: number): boolean {
  if (from === to) return true;
  return from < to ? hour >= from && hour < to : hour >= from || hour < to;
}

/** Attente jusqu'à la prochaine ouverture de la plage, 0 si la plage est ouverte. */
export function msUntilWindowOpen(now: number, from: number, to: number): number {
  const date = new Date(now);
  if (inAutoWindow(date.getHours(), from, to)) return 0;
  const open = new Date(now);
  open.setHours(from, 0, 0, 0);
  if (open.getTime() <= now) open.setDate(open.getDate() + 1);
  return open.getTime() - now;
}

const hourLabel = (hour: number): string => `${String(hour).padStart(2, '0')} h`;

/** Une carte dont le prix n'a pas pu être estimé n'est pas redemandée avant ce délai. */
export const NO_PRICE_RETRY_MS = 6 * 3600e3;
/** Nombre maximal de cartes essayées par passage, pour ne pas multiplier les requêtes de prix. */
const ATTEMPTS_PER_FREE = 4;

/**
 * Boucle de mise en vente automatique : à chaque passage, remplit les emplacements libres avec
 * les doublons vendables, selon les réglages de la page Doublons. Elle s'arrête sur une session
 * expirée ou une vérification anti-robot, et se met en pause si Kyara change le format d'une
 * réponse. Elle ne tourne que si un onglet Kyara est ouvert.
 */
export async function runAutoSell(deps: AutoSellDeps, signal: AbortSignal): Promise<StopReason> {
  const skipUntil = new Map<number, number>();
  let placedTotal = 0;
  let active: number | null = null;
  let lastMessage = '';

  const alive = () => !signal.aborted;
  let lastReport: { state: AutoSellStatus['state']; message: string } = {
    state: 'waiting',
    message: '',
  };
  const report = (
    state: AutoSellStatus['state'],
    message: string,
    nextAt: number | null = null,
  ) => {
    lastReport = { state, message };
    deps.report({ state, message, placed: placedTotal, active, nextAt, updatedAt: deps.now() });
  };
  const say = (message: string, kind: LogKind = 'info') => {
    // Un message identique d'un passage à l'autre n'est écrit qu'une fois dans le journal.
    if (message === lastMessage) return;
    lastMessage = message;
    deps.log(message, kind);
  };

  deps.log('vente automatique démarrée');
  while (alive()) {
    if (!(await deps.isEnabled())) {
      report('stopped', 'Désactivée');
      return 'disabled';
    }
    const s = await deps.getSettings();
    let waitMs = s.intervalMin * 60_000;
    let failed = false;
    try {
      if (!inAutoWindow(new Date(deps.now()).getHours(), s.autoFromHour, s.autoToHour)) {
        waitMs = Math.max(60_000, msUntilWindowOpen(deps.now(), s.autoFromHour, s.autoToHour));
        report(
          'waiting',
          `Hors plage ${hourLabel(s.autoFromHour)} → ${hourLabel(s.autoToHour)} : ventes en pause.`,
          deps.now() + waitMs,
        );
        say('hors plage horaire : ventes en pause');
      } else if (await hasShapeChanges()) {
        report('paused', 'Kyara a changé le format de ses réponses : ventes en pause.');
        say('ventes en pause : Kyara a changé le format de ses réponses', 'warn');
      } else {
        report('running', 'Vérification de tes annonces…');
        const market = await getMarket(deps.api);
        active = market.active.length;
        const free = Math.max(0, s.maxSlots - active);
        // Le plafond du passage évite d'écouler tout le stock d'un coup.
        const slots = Math.min(free, s.autoMaxPerPass);
        if (!free) {
          report('waiting', `Tes ${s.maxSlots} emplacements sont occupés.`);
          say(`emplacements occupés (${active}/${s.maxSlots})`);
        } else {
          const candidates = await buildCandidates(deps.api, s, {
            activeIds: new Set(market.active.map((l) => l.characterId)),
            listed: listedCounts(market.active),
            holds: market.holds,
            meta: await deps.getMeta(),
            prices: await deps.getPrices(),
          });
          const now = deps.now();
          // Raretés laissées en collection : elles ne consomment ni requête de prix ni annonce.
          const allowed = candidates.filter((c) => autoSellAllowed(s, c.rarity));
          const unknown = candidates.filter((c) => autoRarityOf(c.rarity) === null).length;
          const skipped = candidates.length - allowed.length - unknown;
          const details = [
            skipped ? `${skipped} gardé(s) par rareté` : '',
            unknown ? `${unknown} sans rareté connue (catalogue pas encore chargé)` : '',
          ]
            .filter(Boolean)
            .join(' · ');
          const todo = allowed
            .filter((c) => !c.blocked && (skipUntil.get(c.id) ?? 0) <= now)
            .slice(0, Math.max(slots * ATTEMPTS_PER_FREE, 8));
          if (!todo.length) {
            const keptNote = details ? ` — ${details}` : '';
            report('waiting', `${free} place(s) libre(s), aucun doublon vendable${keptNote}.`);
            say(`${free} place(s) libre(s), aucun doublon vendable${keptNote}`);
          } else {
            const placed = await sellNext(deps.api, s, todo, slots, {
              log: deps.log,
              sleep: (ms) => deps.sleep(ms, signal),
              listed: listedCounts(market.active),
              source: 'vente automatique',
            });
            placedTotal += placed;
            active += placed;
            lastMessage = '';
            // Cartes sans prix exploitable : on ne les redemande pas à chaque passage.
            for (const c of todo) {
              if (c.blocked && c.blocked !== 'mis en vente')
                skipUntil.set(c.id, now + NO_PRICE_RETRY_MS);
            }
            report(
              'waiting',
              `${placed} annonce(s) créée(s) à ce passage.${details ? ` · ${details}` : ''}`,
            );
            if (!placed) say('aucune carte mise en vente à ce passage');
          }
        }
      }
    } catch (error) {
      if (error instanceof AuthError) {
        deps.log('session expirée : vente automatique en pause', 'warn');
        report('paused', 'Session expirée : ouvre kyara.games pour reprendre.');
        return 'auth';
      }
      if (error instanceof PassRequiredError) {
        deps.log('vérification demandée par Kyara : vente automatique en pause', 'warn');
        report(
          'paused',
          'Vérification demandée par le site : fais une action à la main sur kyara.games, puis réactive.',
        );
        return 'pass_required';
      }
      if (error instanceof ShapeError) {
        failed = true;
        report('paused', `${error.message} : ventes en pause.`);
        say(`${error.message} : ventes en pause`, 'warn');
        await deps.onFailure?.(error.message);
      } else {
        failed = true;
        const message = error instanceof Error ? error.message : 'erreur inconnue';
        report('waiting', `Erreur : ${message}`);
        say(`erreur : ${message}`, 'warn');
        // Une limite de débit a son propre recul : elle ne compte pas comme un échec.
        if (isCircuitFailure(error)) await deps.onFailure?.(message);
        waitMs = Math.min(waitMs, 5 * 60_000);
      }
    }
    if (!failed) await deps.onSuccess?.();
    if (!alive()) break;
    report(
      lastReport.state === 'running' ? 'waiting' : lastReport.state,
      lastReport.message,
      deps.now() + waitMs,
    );
    await deps.sleep(waitMs, signal);
  }
  report('stopped', `Arrêtée : ${placedTotal} annonce(s) créée(s)`);
  return 'aborted';
}
