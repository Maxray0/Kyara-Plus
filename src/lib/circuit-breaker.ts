import { storage } from 'wxt/utils/storage';
import { AuthError, PassRequiredError } from './api';
import { getSettings, settingsItem } from './settings';

/**
 * Coupe-circuit unique des automatisations. Chaque boucle signale ses échecs : après
 * `CIRCUIT_FAILURE_LIMIT` échecs consécutifs d'une même boucle, `killSwitch` passe à
 * vrai et tous les superviseurs s'arrêtent. Seule une réactivation explicite (panneau
 * ou `POST /toggles {"killSwitch":false}`) remet les boucles en marche.
 */
export const CIRCUIT_FAILURE_LIMIT = 3;

export interface CircuitState {
  /** Déclenchement automatique, avec sa cause ; faux pour un arrêt manuel. */
  tripped: boolean;
  /** Instant du déclenchement. */
  at: number;
  /** Dernier échec lisible. */
  reason: string;
  /** Boucle du dernier échec. */
  source: string | null;
  /** Échecs consécutifs de la boucle du dernier échec. */
  failures: number;
  /**
   * Échecs consécutifs de chaque boucle. Un compteur unique serait écrasé dès qu'une
   * autre boucle échoue : trois échecs alternés ne déclencheraient jamais l'arrêt.
   */
  streaks: Record<string, number>;
}

/** Boucles suivies au maximum, pour borner un stockage modifié à la main. */
const MAX_STREAKS = 16;
const MAX_STREAK = 1_000;

/** État vierge, toujours neuf (les compteurs ne doivent pas être partagés). */
export function emptyCircuit(): CircuitState {
  return { tripped: false, at: 0, reason: '', source: null, failures: 0, streaks: {} };
}

export const EMPTY_CIRCUIT: Readonly<CircuitState> = Object.freeze(emptyCircuit());

export const circuitItem = storage.defineItem<CircuitState>('local:circuitBreaker', {
  fallback: emptyCircuit(),
  version: 1,
});

function normalizeStreaks(raw: unknown): Record<string, number> {
  const source =
    raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const streaks: Record<string, number> = {};
  for (const [key, value] of Object.entries(source)) {
    const name = key.trim().slice(0, 40);
    const count = Number(value);
    if (!name || !Number.isFinite(count) || count <= 0) continue;
    streaks[name] = Math.min(MAX_STREAK, Math.trunc(count));
    if (Object.keys(streaks).length >= MAX_STREAKS) break;
  }
  return streaks;
}

export function normalizeCircuit(raw: unknown): CircuitState {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const at = Number(source.at);
  const failures = Number(source.failures);
  const origin =
    typeof source.source === 'string' && source.source ? source.source.slice(0, 40) : null;
  const streaks = normalizeStreaks(source.streaks);
  // Ancien format (un seul couple source/failures) : on le rattache à sa boucle.
  if (!Object.keys(streaks).length && origin && Number.isFinite(failures) && failures > 0) {
    streaks[origin] = Math.min(MAX_STREAK, Math.trunc(failures));
  }
  return {
    tripped: source.tripped === true,
    at: Number.isFinite(at) && at > 0 ? at : 0,
    reason: typeof source.reason === 'string' ? source.reason.trim().slice(0, 200) : '',
    source: origin,
    failures:
      Number.isFinite(failures) && failures > 0 ? Math.min(MAX_STREAK, Math.trunc(failures)) : 0,
    streaks,
  };
}

/** Écritures sérialisées : deux boucles ne peuvent pas perdre le compteur l'une de l'autre. */
let chain: Promise<unknown> = Promise.resolve();
function serialize<T>(task: () => Promise<T>): Promise<T> {
  const next = chain.then(task, task);
  chain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

export async function readCircuit(): Promise<CircuitState> {
  return normalizeCircuit(await circuitItem.getValue().catch(() => null));
}

/** Le coupe-circuit est ouvert dès que `killSwitch` est vrai (arrêt auto ou manuel). */
export async function isCircuitOpen(): Promise<boolean> {
  return (await getSettings()).killSwitch;
}

/**
 * Une session expirée ou une vérification anti-robot ont leur propre reprise : elles ne
 * comptent pas comme des échecs du coupe-circuit. Une limite de débit, si : trois refus
 * consécutifs signalent un site qui ne veut plus de la cadence.
 */
export function isCircuitFailure(error: unknown): boolean {
  return !(error instanceof AuthError || error instanceof PassRequiredError);
}

/**
 * Note un échec. Chaque boucle garde son propre compteur consécutif : les échecs des
 * autres boucles ne l'effacent pas, et seule une réussite de la même boucle remet sa
 * série à zéro.
 */
export function recordCircuitFailure(
  source: string,
  reason: string,
  now = Date.now(),
): Promise<CircuitState> {
  return serialize(async () => {
    const state = await readCircuit();
    const settings = await getSettings();
    if (settings.killSwitch) return state;
    // Chaque boucle ne compte que ses propres échecs consécutifs.
    const streaks = { ...state.streaks };
    const failures = Math.min(MAX_STREAK, (streaks[source] ?? 0) + 1);
    streaks[source] = failures;
    const message = reason.trim().slice(0, 200) || 'échec inconnu';
    if (failures < CIRCUIT_FAILURE_LIMIT) {
      const next: CircuitState = {
        tripped: false,
        at: state.at,
        reason: message,
        source,
        failures,
        streaks,
      };
      await circuitItem.setValue(next);
      return next;
    }
    // Le drapeau est écrit avant le détail : c'est lui qui arrête réellement les boucles.
    await settingsItem.setValue({ ...settings, killSwitch: true });
    const next: CircuitState = { tripped: true, at: now, reason: message, source, failures, streaks };
    await circuitItem.setValue(next);
    return next;
  });
}

/** Passe réussie : la série d'échecs de cette boucle est terminée. */
export function recordCircuitSuccess(source: string): Promise<CircuitState> {
  return serialize(async () => {
    const state = await readCircuit();
    if (state.tripped || (state.streaks[source] ?? 0) === 0) return state;
    const streaks = { ...state.streaks };
    delete streaks[source];
    const last = state.source === source;
    const next: CircuitState = {
      ...state,
      reason: last ? '' : state.reason,
      source: last ? null : state.source,
      failures: last ? 0 : state.failures,
      streaks,
    };
    await circuitItem.setValue(next);
    return next;
  });
}

/** Réarmement manuel : efface la cause et autorise de nouveau les boucles. */
export function resetCircuit(): Promise<CircuitState> {
  return serialize(async () => {
    await circuitItem.setValue(emptyCircuit());
    const settings = await getSettings();
    if (settings.killSwitch) await settingsItem.setValue({ ...settings, killSwitch: false });
    return emptyCircuit();
  });
}

/** Rapporteurs prêts à brancher sur une boucle. */
export function circuitReporter(source: string, now: () => number = Date.now) {
  return {
    async fail(reason: string): Promise<void> {
      await recordCircuitFailure(source, reason, now());
    },
    async ok(): Promise<void> {
      await recordCircuitSuccess(source);
    },
  };
}
