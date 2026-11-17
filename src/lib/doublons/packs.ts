import type { ApiClient } from '../api';

/**
 * Conseil boosters, en lecture seule : pour chaque booster vendu, on lit son pool exact
 * (`/api/packs/{id}/characters`) et ses chances officielles par rareté, puis on estime les
 * cartes nouvelles par ouverture (booster doré compris) et le prix par carte nouvelle.
 *
 * Repris de Kyara Helper : `newPerOpening` pondère chaque rareté par sa probabilité, au
 * lieu de supposer un tirage uniforme sur le pool.
 */

export type Api = Pick<ApiClient, 'request'>;

/** Pools relus par analyse : borne le coût réseau. */
export const PACKS_MAX_POOLS = 12;

export interface PackRates {
  /** Espérance de cartes par rareté pour une ouverture normale. */
  perBooster: Record<string, number>;
  /** Espérance pour une ouverture dorée. */
  golden: Record<string, number>;
}

export interface PackInfo {
  id: string;
  name: string;
  /** Prix d'une ouverture, en ◆ (0 si le pack ne s'ouvre qu'avec des boosters gratuits). */
  price: number;
  /** Cartes obtenues par ouverture. */
  cards: number;
  /** Ouvrable avec les boosters gratuits. */
  free: boolean;
  /** Sous-titre du site, utile pour le repli par série / rang. */
  sub?: string;
  series?: string[];
  /** Chances officielles par rareté, quand le site les expose. */
  rates?: PackRates;
  goldenEligible?: boolean;
  /** Fenêtre de disponibilité du booster. */
  schedule?: { start?: string; end?: string };
}

export interface PackAdvice {
  pack: PackInfo;
  /** Cartes du pool. */
  pool: number;
  /** Cartes du pool absentes de la collection. */
  missing: number;
  /** Cartes nouvelles attendues par ouverture, pondérées par les raretés. */
  expectedNew: number;
  /** Prix par carte nouvelle attendue, `null` si gratuit ou pool complet. */
  costPerNew: number | null;
}

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const numberMap = (value: unknown): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(record(value))) {
    const number = Number(raw);
    if (Number.isFinite(number) && number > 0) out[key] = number;
  }
  return out;
};

function ratesOf(value: unknown): PackRates | undefined {
  const rates = record(value);
  const perBooster = numberMap(rates.perBooster);
  if (!Object.keys(perBooster).length) return undefined;
  return { perBooster, golden: numberMap(record(rates.golden).perBooster) };
}

export function normalizePacks(raw: unknown): PackInfo[] {
  const source = record(raw);
  const rows = Array.isArray(raw)
    ? (raw as unknown[])
    : Array.isArray(source.items)
      ? (source.items as unknown[])
      : [];
  const packs: PackInfo[] = [];
  for (const row of rows) {
    const pack = record(row);
    if (pack.grantOnly === true) continue;
    const id = String(pack.id ?? '');
    if (!id) continue;
    const price = Number(pack.chakraPrice ?? pack.price);
    const slots = Array.isArray(pack.slots)
      ? pack.slots.length
      : Array.isArray(record(pack.rates).slots)
        ? (record(pack.rates).slots as unknown[]).length
        : 0;
    const schedule = record(pack.schedule);
    const series = Array.isArray(pack.series)
      ? pack.series.map((entry) => String(entry)).filter(Boolean)
      : [];
    const rates = ratesOf(pack.rates);
    packs.push({
      id,
      name: String(pack.name ?? pack.sub ?? id),
      price: Number.isFinite(price) && price > 0 ? price : 0,
      cards: slots > 0 ? slots : 5,
      free: pack.usesFreePacks === true,
      ...(typeof pack.sub === 'string' && pack.sub ? { sub: pack.sub } : {}),
      ...(series.length ? { series } : {}),
      ...(rates ? { rates } : {}),
      ...(pack.goldenEligible === true ? { goldenEligible: true } : {}),
      ...(Object.keys(schedule).length
        ? {
            schedule: {
              ...(typeof schedule.start === 'string' ? { start: schedule.start } : {}),
              ...(typeof schedule.end === 'string' ? { end: schedule.end } : {}),
            },
          }
        : {}),
    });
  }
  return packs;
}

/** Un booster hors de sa fenêtre de disponibilité n'est pas proposé. */
export function packAvailable(pack: PackInfo, now = Date.now()): boolean {
  const start = pack.schedule?.start ? Date.parse(pack.schedule.start) : Number.NaN;
  const end = pack.schedule?.end ? Date.parse(pack.schedule.end) : Number.NaN;
  if (Number.isFinite(start) && start > now) return false;
  if (Number.isFinite(end) && end <= now) return false;
  return true;
}

const missingIn = (pool: readonly number[], owned: ReadonlyMap<number, number>): number =>
  pool.reduce((count, id) => count + ((owned.get(id) ?? 0) > 0 ? 0 : 1), 0);

/** Identifiants de cartes d'un pool (`/api/packs/{id}/characters`). */
export function poolIds(raw: unknown): number[] {
  const rows = Array.isArray(raw) ? raw : [];
  const ids: number[] = [];
  for (const row of rows) {
    const id = Number(record(row).id ?? row);
    if (Number.isSafeInteger(id) && id > 0) ids.push(id);
  }
  return [...new Set(ids)];
}

/** Cartes nouvelles attendues par ouverture, si le pool est tiré uniformément. */
export function expectedNew(
  pool: readonly number[],
  owned: ReadonlyMap<number, number>,
  cards: number,
): number {
  if (!pool.length || cards <= 0) return 0;
  return (cards * missingIn(pool, owned)) / pool.length;
}

/**
 * Reprise de `newPerOpening` de Kyara Helper : pour chaque rareté, l'espérance officielle
 * d'une ouverture normale est mélangée à celle du booster doré (une ouverture sur `every`),
 * puis multipliée par la part des cartes du pool encore manquantes.
 */
export function expectedNewWeighted(
  pack: PackInfo,
  pool: readonly number[],
  owned: ReadonlyMap<number, number>,
  rarityOf: ReadonlyMap<number, string>,
  every = 10,
): number {
  const rates = pack.rates;
  if (!rates) return expectedNew(pool, owned, pack.cards);
  const candidates: Record<string, number> = {};
  const mine: Record<string, number> = {};
  for (const id of pool) {
    const rarity = rarityOf.get(id);
    if (!rarity) continue;
    candidates[rarity] = (candidates[rarity] ?? 0) + 1;
    if ((owned.get(id) ?? 0) > 0) mine[rarity] = (mine[rarity] ?? 0) + 1;
  }
  let total = 0;
  for (const [rarity, expected] of Object.entries(rates.perBooster)) {
    const candidate = candidates[rarity] ?? 0;
    if (!candidate || expected <= 0) continue;
    const golden = pack.goldenEligible ? (rates.golden[rarity] ?? expected) : expected;
    const blended = ((every - 1) * expected + golden) / Math.max(1, every);
    total += blended * (1 - (mine[rarity] ?? 0) / candidate);
  }
  return total;
}

/**
 * Classe les boosters chiffrés du plus rentable (prix par carte nouvelle) au moins
 * rentable ; un booster dont le pool est entièrement possédé passe en dernier.
 */
export function advisePacks(
  packs: readonly PackInfo[],
  pools: ReadonlyMap<string, readonly number[]>,
  owned: ReadonlyMap<number, number>,
  options: { rarityOf?: ReadonlyMap<number, string>; every?: number } = {},
): PackAdvice[] {
  const rows: PackAdvice[] = [];
  for (const pack of packs) {
    const pool = pools.get(pack.id);
    if (!pool || !pool.length) continue;
    const expected = options.rarityOf
      ? expectedNewWeighted(pack, pool, owned, options.rarityOf, options.every ?? 10)
      : expectedNew(pool, owned, pack.cards);
    rows.push({
      pack,
      pool: pool.length,
      missing: missingIn(pool, owned),
      expectedNew: expected,
      costPerNew: pack.price > 0 && expected > 0 ? pack.price / expected : null,
    });
  }
  return rows.sort(
    (a, b) =>
      (a.costPerNew ?? Number.POSITIVE_INFINITY) - (b.costPerNew ?? Number.POSITIVE_INFINITY) ||
      b.expectedNew - a.expectedNew ||
      a.pack.name.localeCompare(b.pack.name, 'fr'),
  );
}
