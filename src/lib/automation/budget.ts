import { storage } from 'wxt/utils/storage';

/**
 * Budget partagé des boucles automatiques : toutes les requêtes d'automatisation passent
 * par une seule file, avec un écart minimal et un plafond par minute glissante. Les boucles
 * (auto-open, auto-sell, reprix, envoi auto, veille) ne peuvent donc plus se cumuler en
 * rafale ; le compteur est publié pour l'interface.
 */

export interface BudgetSettings {
  /** Requêtes autorisées par minute glissante, toutes boucles confondues. */
  perMinute: number;
  /** Écart minimal entre deux départs de requête. */
  minGapMs: number;
}

export const BUDGET_DEFAULT: Readonly<BudgetSettings> = { perMinute: 40, minGapMs: 400 };
export const BUDGET_LIMITS = {
  perMinute: { min: 5, max: 120 },
  minGapMs: { min: 200, max: 5000 },
} as const;

export const budgetSettingsItem = storage.defineItem<BudgetSettings>('local:automationBudget', {
  fallback: { ...BUDGET_DEFAULT },
  version: 1,
});

export interface BudgetSnapshot {
  /** Dernière publication du compteur. */
  at: number;
  /** Requêtes accordées sur la minute glissante. */
  used: number;
  perMinute: number;
  minGapMs: number;
  /** Prises en attente dans la file. */
  waiting: number;
}

export const EMPTY_BUDGET_STATS: Readonly<BudgetSnapshot> = {
  at: 0,
  used: 0,
  perMinute: BUDGET_DEFAULT.perMinute,
  minGapMs: BUDGET_DEFAULT.minGapMs,
  waiting: 0,
};

export const budgetStatsItem = storage.defineItem<BudgetSnapshot>('local:automationBudgetStats', {
  fallback: { ...EMPTY_BUDGET_STATS },
  version: 1,
});

function bound(value: unknown, fallback: number, min: number, max: number): number {
  const number = typeof value === 'string' ? Number(value) : value;
  if (typeof number !== 'number' || !Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

export function normalizeBudget(raw: unknown): BudgetSettings {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    perMinute: bound(
      source.perMinute,
      BUDGET_DEFAULT.perMinute,
      BUDGET_LIMITS.perMinute.min,
      BUDGET_LIMITS.perMinute.max,
    ),
    minGapMs: bound(
      source.minGapMs,
      BUDGET_DEFAULT.minGapMs,
      BUDGET_LIMITS.minGapMs.min,
      BUDGET_LIMITS.minGapMs.max,
    ),
  };
}

export function budgetLabel(snapshot: BudgetSnapshot): string {
  if (!snapshot.at) return 'Budget : aucune requête automatique récente';
  return `Budget : ${snapshot.used}/${snapshot.perMinute} requête(s)/min${
    snapshot.waiting ? ` · ${snapshot.waiting} en attente` : ''
  }`;
}

export interface RequestBudgetOptions {
  settings?: () => Promise<BudgetSettings>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  writeStats?: (snapshot: BudgetSnapshot) => Promise<void>;
}

const STATS_EVERY_MS = 5_000;

/** File unique + minute glissante. Une prise ne rend la main qu'une fois sa requête permise. */
export class RequestBudget {
  private queue: Promise<void> = Promise.resolve();
  private granted: number[] = [];
  private waiting = 0;
  private lastStats = Number.NEGATIVE_INFINITY;
  private readonly settings: () => Promise<BudgetSettings>;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly writeStats: (snapshot: BudgetSnapshot) => Promise<void>;

  constructor(options: RequestBudgetOptions = {}) {
    this.settings = options.settings ?? (async () => normalizeBudget(await budgetSettingsItem.getValue()));
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? ((ms) => new Promise<void>((done) => setTimeout(done, ms)));
    this.writeStats =
      options.writeStats ??
      ((snapshot) => budgetStatsItem.setValue(snapshot).catch(() => undefined));
  }

  /** Réserve une place : attend l'écart minimal puis une place dans la minute glissante. */
  take(): Promise<void> {
    this.waiting += 1;
    const run = this.queue.then(() => this.grant());
    this.queue = run.catch(() => undefined);
    return run.finally(() => {
      this.waiting -= 1;
    });
  }

  /** Compteur courant, sans effet de bord. */
  snapshot(): BudgetSnapshot {
    const now = this.now();
    const recent = this.recent(now);
    const settings = this.currentSettings;
    return {
      at: now,
      used: recent.length,
      perMinute: settings.perMinute,
      minGapMs: settings.minGapMs,
      waiting: this.waiting,
    };
  }

  private currentSettings: BudgetSettings = { ...BUDGET_DEFAULT };

  private recent(now: number): number[] {
    this.granted = this.granted.filter((at) => now - at < 60_000);
    return this.granted;
  }

  private async grant(): Promise<void> {
    for (;;) {
      const settings = await this.settings().catch(() => ({ ...BUDGET_DEFAULT }));
      this.currentSettings = settings;
      const now = this.now();
      const recent = this.recent(now);
      const last = recent.at(-1);
      const gapWait = last === undefined ? 0 : Math.max(0, settings.minGapMs - (now - last));
      const windowWait =
        recent.length >= settings.perMinute
          ? Math.max(0, 60_000 - (now - (recent[0] ?? now)))
          : 0;
      const wait = Math.max(gapWait, windowWait);
      if (wait <= 0) {
        this.granted.push(now);
        this.publish(settings);
        return;
      }
      await this.sleep(wait);
    }
  }

  private publish(settings: BudgetSettings): void {
    const now = this.now();
    if (now - this.lastStats < STATS_EVERY_MS) return;
    this.lastStats = now;
    const snapshot: BudgetSnapshot = {
      at: now,
      used: this.recent(now).length,
      perMinute: settings.perMinute,
      minGapMs: settings.minGapMs,
      waiting: this.waiting,
    };
    void this.writeStats(snapshot).catch(() => undefined);
  }
}

/** Instance partagée par toutes les boucles du content script. */
export const automationBudget = new RequestBudget();
