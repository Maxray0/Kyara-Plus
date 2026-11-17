/**
 * Minuterie d'actualisation du comptoir : une seule requête à la fois, jamais quand
 * l'onglet est masqué ou qu'une autre section est ouverte. `pause` conserve l'échéance
 * pour qu'une absence courte ne décale pas la prochaine lecture ; `stop` l'oublie.
 * Le timer est injectable pour les tests.
 */

export interface TradeRefreshState {
  /** Un intervalle positif est configuré. */
  enabled: boolean;
  /** La minuterie est active ; `false` après une pause ou un arrêt. */
  running: boolean;
  /** Une actualisation est en cours. */
  refreshing: boolean;
  lastAttemptAt: number | null;
  lastSuccessAt: number | null;
  nextAt: number | null;
}

export interface TradeRefreshOptions {
  /** Intervalle entre deux actualisations, en millisecondes. 0 désactive la minuterie. */
  intervalMs: number;
  /** Retourne true si l'actualisation a réussi. */
  refresh: () => Promise<boolean>;
  /** Par exemple : onglet Échanges affiché et document visible. */
  isActive?: () => boolean;
  now?: () => number;
  setTimer?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
  onState?: (state: TradeRefreshState) => void;
}

type Timer = ReturnType<typeof setTimeout>;

export class TradeRefresh {
  private timer: Timer | null = null;
  private inFlight = false;
  private running = false;
  private intervalMs: number;
  private lastAttemptAt: number | null = null;
  private lastSuccessAt: number | null = null;
  private nextAt: number | null = null;
  private readonly setTimer: (callback: () => void, delay: number) => Timer;
  private readonly clearTimer: (timer: Timer) => void;

  constructor(private readonly options: TradeRefreshOptions) {
    this.intervalMs = Math.max(0, Math.floor(options.intervalMs));
    this.setTimer = options.setTimer ?? ((callback, delay) => setTimeout(callback, delay));
    this.clearTimer = options.clearTimer ?? ((timer) => clearTimeout(timer));
  }

  state(): TradeRefreshState {
    return {
      enabled: this.intervalMs > 0,
      running: this.running,
      refreshing: this.inFlight,
      lastAttemptAt: this.lastAttemptAt,
      lastSuccessAt: this.lastSuccessAt,
      nextAt: this.nextAt,
    };
  }

  start(): void {
    this.running = true;
    if (this.timer || this.inFlight) {
      this.emit();
      return;
    }
    // Une reprise après `pause` repart sur l'échéance restante, pas sur un cycle complet.
    const remaining = this.nextAt === null ? this.intervalMs : this.nextAt - this.now();
    this.schedule(Math.max(0, remaining));
  }

  /** Suspend sans perdre l'échéance : une courte absence ne décale pas la prochaine lecture. */
  pause(): void {
    this.running = false;
    this.cancel();
    this.emit();
  }

  stop(): void {
    this.running = false;
    this.cancel();
    this.nextAt = null;
    this.emit();
  }

  /** Prend en compte un nouveau réglage sans perdre l'état des dernières actualisations. */
  setInterval(intervalMs: number): void {
    const next = Math.max(0, Math.floor(intervalMs));
    if (next === this.intervalMs) {
      this.emit();
      return;
    }
    this.intervalMs = next;
    // Un nouvel intervalle invalide l'échéance calculée avec l'ancien.
    this.nextAt = null;
    if (this.running && !this.inFlight) this.schedule();
    else this.emit();
  }

  /** Actualise tout de suite, par exemple au retour sur l'onglet ou après une période masquée. */
  async refreshNow(): Promise<boolean> {
    if (!this.running || this.intervalMs <= 0 || this.inFlight) return false;
    this.cancel();
    return this.fire();
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  private active(): boolean {
    return !this.options.isActive || this.options.isActive();
  }

  private emit(): void {
    this.options.onState?.(this.state());
  }

  private cancel(): void {
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
  }

  private schedule(delay = this.intervalMs): void {
    this.cancel();
    if (!this.running || this.intervalMs <= 0 || !this.active()) {
      this.nextAt = null;
      this.emit();
      return;
    }
    if (delay <= 0) {
      this.nextAt = null;
      void this.fire();
      return;
    }
    this.nextAt = this.now() + delay;
    this.timer = this.setTimer(() => {
      this.timer = null;
      void this.fire();
    }, delay);
    this.emit();
  }

  private async fire(): Promise<boolean> {
    this.cancel();
    if (!this.running || this.intervalMs <= 0) {
      this.nextAt = null;
      this.emit();
      return false;
    }
    if (this.inFlight) {
      this.schedule();
      return false;
    }
    if (!this.active()) {
      this.schedule();
      return false;
    }

    this.inFlight = true;
    this.lastAttemptAt = this.now();
    this.nextAt = null;
    this.emit();

    let ok = false;
    try {
      ok = await this.options.refresh();
      if (ok) this.lastSuccessAt = this.now();
    } catch {
      // L'échec est retenté au prochain intervalle ; la page affiche l'erreur.
    } finally {
      this.inFlight = false;
      this.schedule();
    }
    return ok;
  }
}
