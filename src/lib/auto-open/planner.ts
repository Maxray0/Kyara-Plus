export interface PackInfo {
  id: string;
  name: string;
  chakraPrice: number;
  usesFreePacks: boolean;
  grantOnly: boolean;
}

export interface Account {
  chakra: number;
  freePacks: number;
  bonusPacks: number;
  freePacksMax: number;
  /** Date (ms) du prochain booster offert, ou null si le serveur ne la donne pas. */
  nextFreeAt: number | null;
}

export interface PackState {
  grants: Record<string, number>;
  limitsLeft: Record<string, number>;
}

export type Source = 'grant' | 'free' | 'chakra';
export interface Cost {
  source: Source;
  chakra: number;
}

export const REGEN_MIN = 10;
export const DEFAULT_STACK_MAX = 10;

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function nonNegative(value: unknown): number {
  return Math.max(0, num(value) ?? 0);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Garde seulement les entrées de booster (celles qui ont des taux de tirage). */
export function normalizePacks(data: unknown): PackInfo[] {
  const source = record(data);
  const list = Array.isArray(data) ? data : Array.isArray(source.packs) ? source.packs : [];
  const packs: PackInfo[] = [];
  for (const entry of list) {
    const pack = record(entry);
    if (!pack.rates || pack.id === undefined || pack.id === null) continue;
    packs.push({
      id: String(pack.id),
      name: String(pack.name ?? pack.id),
      chakraPrice: nonNegative(pack.chakraPrice),
      usesFreePacks: pack.usesFreePacks === true,
      grantOnly: pack.grantOnly === true,
    });
  }
  return packs;
}

export function normalizePackState(data: unknown): PackState {
  const source = record(data);
  const grants: Record<string, number> = {};
  for (const [id, value] of Object.entries(record(source.grants))) grants[id] = nonNegative(value);
  const limitsLeft: Record<string, number> = {};
  for (const [id, value] of Object.entries(record(source.limits))) {
    const left = num(record(value).left);
    if (left !== null) limitsLeft[id] = Math.max(0, left);
  }
  return { grants, limitsLeft };
}

/** Fusionne une réponse partielle du serveur : une valeur absente ne remplace rien. */
export function mergeUser(base: Record<string, unknown>, patch: unknown): Record<string, unknown> {
  const next = { ...base };
  for (const [key, value] of Object.entries(record(patch))) {
    if (value !== undefined && value !== null) next[key] = value;
  }
  return next;
}

export function toAccount(user: Record<string, unknown>): Account {
  const raw = user.nextFreeAt ?? user.nextFreePackAt ?? user.freePackAt ?? user.nextFree ?? null;
  const stamp = typeof raw === 'string' || typeof raw === 'number' ? Date.parse(String(raw)) : NaN;
  return {
    chakra: nonNegative(user.chakra),
    freePacks: nonNegative(user.freePacks),
    bonusPacks: nonNegative(user.bonusPacks),
    freePacksMax: Math.max(1, Math.round(num(user.freePacksMax) ?? DEFAULT_STACK_MAX)),
    nextFreeAt: Number.isFinite(stamp) ? stamp : null,
  };
}

export function availability(
  pack: PackInfo,
  account: Account,
  state: PackState,
  allowChakra: boolean,
) {
  const grants = state.grants[pack.id] ?? 0;
  const free = pack.usesFreePacks ? account.freePacks + account.bonusPacks : 0;
  const paid =
    allowChakra && pack.chakraPrice > 0 ? Math.floor(account.chakra / pack.chakraPrice) : 0;
  let total = grants + free + paid;
  const limit = state.limitsLeft[pack.id];
  if (limit !== undefined) total = Math.min(total, grants + limit);
  return { grants, free, paid, total };
}

/** Tire au hasard un booster qui a encore des ouvertures possibles. */
export function pickPack(
  packs: PackInfo[],
  account: Account,
  state: PackState,
  allowChakra: boolean,
  random: () => number,
): PackInfo | null {
  const ready = packs.filter((pack) => availability(pack, account, state, allowChakra).total > 0);
  if (!ready.length) return null;
  return ready[Math.floor(random() * ready.length)] ?? null;
}

/** Ce que coûte la prochaine ouverture : dons, puis boosters offerts, puis chakra (si autorisé). */
export function nextCost(
  pack: PackInfo,
  account: Account,
  state: PackState,
  allowChakra: boolean,
): Cost {
  if ((state.grants[pack.id] ?? 0) > 0) return { source: 'grant', chakra: 0 };
  if (pack.usesFreePacks && account.freePacks + account.bonusPacks > 0) {
    return { source: 'free', chakra: 0 };
  }
  return { source: 'chakra', chakra: allowChakra ? pack.chakraPrice : 0 };
}

/** Met à jour le compte local après une ouverture, en attendant la réponse du serveur. */
export function applyCost(
  pack: PackInfo,
  cost: Cost,
  account: Account,
  state: PackState,
): { account: Account; state: PackState } {
  const nextAccount = { ...account };
  const nextState: PackState = { grants: { ...state.grants }, limitsLeft: { ...state.limitsLeft } };
  if (cost.source === 'grant') {
    nextState.grants[pack.id] = Math.max(0, (nextState.grants[pack.id] ?? 0) - 1);
  } else if (cost.source === 'free') {
    if (nextAccount.freePacks > 0) nextAccount.freePacks -= 1;
    else nextAccount.bonusPacks = Math.max(0, nextAccount.bonusPacks - 1);
  } else {
    nextAccount.chakra = Math.max(0, nextAccount.chakra - cost.chakra);
  }
  const left = nextState.limitsLeft[pack.id];
  if (left !== undefined) nextState.limitsLeft[pack.id] = Math.max(0, left - 1);
  return { account: nextAccount, state: nextState };
}

export interface DelayRange {
  immediate: boolean;
  /** Minutes à attendre avant le prochain booster gratuit (0 si ouverture immédiate). */
  waitMin: number;
}

/**
 * Cadence : un booster gratuit arrive toutes les 10 min. Tant qu'il en reste un, il s'ouvre
 * tout de suite (aucune raison d'attendre) ; sinon on attend exactement le prochain, d'après
 * `nextFreeAt`, ou 10 min quand le serveur ne donne pas d'heure.
 */
export function delayRange(account: Account, now: number): DelayRange {
  if (account.freePacks + account.bonusPacks > 0) return { immediate: true, waitMin: 0 };
  if (account.nextFreeAt === null) return { immediate: false, waitMin: REGEN_MIN };
  const remaining = (account.nextFreeAt - now) / 60_000;
  if (remaining <= 0) return { immediate: true, waitMin: 0 };
  return { immediate: false, waitMin: Math.max(1, Math.ceil(remaining)) };
}

/** Attente jusqu'au prochain booster gratuit ; zéro quand un booster est déjà disponible. */
export function nextDelayMs(range: DelayRange): number {
  return range.immediate ? 0 : range.waitMin * 60_000;
}

const STOP_TEXT: Record<string, string> = {
  guest_limit: 'compte invité : connecte-toi avec Discord',
  no_funds: 'chakra insuffisant',
  insufficient_chakra: 'chakra insuffisant',
  rate_limited: 'trop de requêtes',
  limit: 'limite atteinte',
  daily_limit: 'limite quotidienne atteinte',
  no_packs: 'plus de boosters disponibles',
  pass_required: 'vérification demandée',
};

export function stoppedText(stopped: unknown): string {
  const info = record(stopped);
  const code = String(info.code ?? info.reason ?? '');
  return STOP_TEXT[code] ?? (code || 'raison inconnue');
}
