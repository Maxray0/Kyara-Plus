export type StopReason = 'disabled' | 'aborted' | 'pass_required' | 'auth';

export type LockResult<T> = { acquired: true; value: T } | { acquired: false };

export interface SupervisorDeps {
  isEnabled: () => Promise<boolean>;
  run: (signal: AbortSignal) => Promise<StopReason>;
  /** Un seul onglet à la fois fait tourner la boucle. */
  withLock: <T>(task: () => Promise<T>) => Promise<LockResult<T>>;
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
}

const LOCK_RETRY_MS = 30_000;
const AUTH_RETRY_MS = 60_000;

/**
 * Démarre et arrête une boucle automatique selon son réglage. Après `pass_required` la boucle
 * reste arrêtée jusqu'à ce que l'utilisateur désactive puis réactive l'option.
 */
export function createSupervisor(deps: SupervisorDeps) {
  let controller: AbortController | null = null;
  let blocked = false;

  async function apply(): Promise<void> {
    if (!(await deps.isEnabled())) {
      controller?.abort();
      controller = null;
      blocked = false;
      return;
    }
    if (controller || blocked) return;
    start();
  }

  function start(): void {
    const current = new AbortController();
    controller = current;
    void (async () => {
      let reason: StopReason | 'locked' | 'error';
      try {
        const result = await deps.withLock(() => deps.run(current.signal));
        reason = result.acquired ? result.value : 'locked';
      } catch {
        reason = 'error';
      } finally {
        if (controller === current) controller = null;
      }
      if (current.signal.aborted) return;
      if (reason === 'pass_required') {
        blocked = true;
        return;
      }
      if (reason === 'locked') await deps.sleep(LOCK_RETRY_MS, current.signal);
      else if (reason === 'auth' || reason === 'error') {
        await deps.sleep(AUTH_RETRY_MS, current.signal);
      }
      if (!current.signal.aborted) await apply();
    })();
  }

  function stop(): void {
    controller?.abort();
    controller = null;
  }

  return { apply, stop };
}

/** Verrou entre onglets : seul l'onglet qui l'obtient fait tourner la boucle. */
export function webLock(name: string) {
  return async <T>(task: () => Promise<T>): Promise<LockResult<T>> => {
    if (!navigator.locks) return { acquired: true, value: await task() };
    return navigator.locks.request(name, { ifAvailable: true }, async (lock) =>
      lock ? { acquired: true as const, value: await task() } : { acquired: false as const },
    );
  };
}
