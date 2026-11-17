export const STAT_MAX_ACCOUNTS = 20;
export const STAT_CACHE_MS = 12 * 3600 * 1000;

export interface CatalogCard {
  id: string;
  series: string;
  rarity: string;
  name?: string;
  image?: string;
}

export type ColumnKey =
  | 'boosters'
  | 'value'
  | 'rankPos'
  | 'owned'
  | 'copies'
  | 'seriesFinished'
  | 'legendary'
  | 'mythic'
  | 'listings'
  | 'catalogPct';

export interface Column {
  key: ColumnKey;
  label: string;
  title: string;
  /** Vrai quand le plus petit est le meilleur (rang). */
  asc?: boolean;
}

export const STAT_COLUMNS: readonly Column[] = [
  { key: 'boosters', label: 'Boost.', title: 'Boosters ouverts' },
  { key: 'value', label: 'Valeur', title: 'Valeur chakra des cartes' },
  { key: 'rankPos', label: 'Rang', title: 'Classement global (collection)', asc: true },
  { key: 'owned', label: 'Cartes', title: 'Cartes différentes' },
  { key: 'copies', label: 'Ex.', title: 'Exemplaires possédés' },
  { key: 'seriesFinished', label: 'Séries', title: 'Séries terminées' },
  { key: 'legendary', label: 'L', title: 'Légendaires différentes' },
  { key: 'mythic', label: 'M', title: 'Mythiques différentes' },
  { key: 'listings', label: 'Ann.', title: 'Annonces actives' },
  { key: 'catalogPct', label: 'Cat.', title: 'Complétion du catalogue' },
];

export type Source = 'self' | 'friend' | 'manual';

export interface Account {
  id: string;
  pseudo: string;
  avatar: string | null;
  self: boolean;
  source: Source;
  addedAt: number;
  at: number;
  error: string | null;
  owned: number | null;
  doubles: number | null;
  copies: number | null;
  boosters: number | null;
  listings: number | null;
  rankPos: number | null;
  catalogSize: number | null;
  byRarity: Record<string, number>;
  mythic: number | null;
  legendary: number | null;
  value: number | null;
  valuePriced: number;
  valueUnpriced: number;
  valueAt: number;
  seriesFinished: number | null;
  seriesAlmost: number | null;
  dupesValue: number | null;
  collectionAt: number;
}

export interface StatData {
  version: 1;
  at: number;
  accounts: Record<string, Account>;
  owners: Record<string, number>;
  ownerTotal: number;
  sort: ColumnKey;
  /** Meilleur en premier : décroissant, sauf pour le rang. */
  bestFirst: boolean;
  friendsAt: number;
  friendIds: string[];
}

/** Nombre positif ou null : une donnée absente reste absente (Number(null) vaudrait 0). */
export function num(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function stamp(value: unknown): number {
  const n = Number(value);
  return n > 0 ? n : 0;
}

export function rarityOf(value: unknown): string {
  return (
    String(value ?? '')
      .trim()
      .toUpperCase() || 'C'
  );
}

export function emptyData(): StatData {
  return {
    version: 1,
    at: 0,
    accounts: {},
    owners: {},
    ownerTotal: 0,
    sort: 'value',
    bestFirst: true,
    friendsAt: 0,
    friendIds: [],
  };
}

export function emptyAccount(id: string, pseudo: string, source: Source, now: number): Account {
  return {
    id,
    pseudo,
    avatar: null,
    self: source === 'self',
    source,
    addedAt: now,
    at: 0,
    error: null,
    owned: null,
    doubles: null,
    copies: null,
    boosters: null,
    listings: null,
    rankPos: null,
    catalogSize: null,
    byRarity: {},
    mythic: null,
    legendary: null,
    value: null,
    valuePriced: 0,
    valueUnpriced: 0,
    valueAt: 0,
    seriesFinished: null,
    seriesAlmost: null,
    dupesValue: null,
    collectionAt: 0,
  };
}

export function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Revalide un objet relu du stockage : une valeur absente reste absente. */
export function normalizeData(raw: unknown): StatData {
  const source = record(raw);
  const out = emptyData();
  out.at = stamp(source.at);
  out.sort = STAT_COLUMNS.some((c) => c.key === source.sort) ? (source.sort as ColumnKey) : 'value';
  out.bestFirst = source.bestFirst !== false;
  out.ownerTotal = num(source.ownerTotal) ?? 0;
  out.friendsAt = stamp(source.friendsAt);
  out.friendIds = Array.isArray(source.friendIds)
    ? [...new Set(source.friendIds.map((id) => String(id ?? '')).filter(Boolean))]
    : [];

  for (const [id, rawEntry] of Object.entries(record(source.accounts))) {
    const entry = record(rawEntry);
    if (!Object.keys(entry).length) continue;
    const isSelf = entry.self === true || entry.source === 'self';
    const sourceKind: Source = isSelf ? 'self' : entry.source === 'friend' ? 'friend' : 'manual';
    const byRarity: Record<string, number> = {};
    for (const [code, value] of Object.entries(record(entry.byRarity))) {
      const n = num(value);
      if (n) byRarity[rarityOf(code)] = n;
    }
    out.accounts[id] = {
      id,
      pseudo: String(entry.pseudo ?? 'Joueur'),
      avatar: typeof entry.avatar === 'string' ? entry.avatar : null,
      self: isSelf,
      source: sourceKind,
      addedAt: stamp(entry.addedAt) || Date.now(),
      at: stamp(entry.at),
      error: typeof entry.error === 'string' && entry.error ? entry.error : null,
      owned: num(entry.owned),
      doubles: num(entry.doubles),
      copies: num(entry.copies),
      boosters: num(entry.boosters),
      listings: num(entry.listings),
      rankPos: num(entry.rankPos),
      catalogSize: num(entry.catalogSize),
      byRarity,
      mythic: num(entry.mythic),
      legendary: num(entry.legendary),
      value: num(entry.value),
      valuePriced: num(entry.valuePriced) ?? 0,
      valueUnpriced: num(entry.valueUnpriced) ?? 0,
      valueAt: stamp(entry.valueAt),
      seriesFinished: num(entry.seriesFinished),
      seriesAlmost: num(entry.seriesAlmost),
      dupesValue: num(entry.dupesValue),
      collectionAt: stamp(entry.collectionAt),
    };
  }

  for (const [cardId, count] of Object.entries(record(source.owners))) {
    const n = num(count);
    if (n) out.owners[String(cardId)] = n;
  }
  return out;
}

/**
 * Séries « finies » (toutes les cartes du catalogue possédées) et « presque finies »
 * (3 cartes ou moins manquantes). Les cartes possédées absentes du catalogue sont ignorées.
 */
export function seriesProgress(ownedIds: Iterable<string>, catalog: readonly CatalogCard[]) {
  const owned = new Set([...ownedIds].map(String));
  const bySeries = new Map<string, { total: number; owned: number }>();
  for (const card of catalog) {
    const name = card.series || 'Inconnue';
    const entry = bySeries.get(name) ?? { total: 0, owned: 0 };
    entry.total += 1;
    if (owned.has(card.id)) entry.owned += 1;
    bySeries.set(name, entry);
  }
  let finished = 0;
  let almost = 0;
  for (const entry of bySeries.values()) {
    if (entry.owned >= entry.total) finished += 1;
    else if (entry.total - entry.owned <= 3) almost += 1;
  }
  return { finished, almost, series: bySeries.size };
}

/** Somme des prix connus ; une carte sans prix est comptée à part, jamais valorisée au hasard. */
export function collectionValue(ownedIds: Iterable<string>, prices: ReadonlyMap<string, number>) {
  let value = 0;
  let priced = 0;
  let unpriced = 0;
  for (const id of ownedIds) {
    const price = prices.get(String(id));
    if (price !== undefined && Number.isFinite(price) && price > 0) {
      value += price;
      priced += 1;
    } else {
      unpriced += 1;
    }
  }
  return { value, priced, unpriced };
}

export function unionIds(lists: Iterable<Iterable<string> | null>): Set<string> {
  const ids = new Set<string>();
  for (const list of lists) {
    for (const id of list ?? []) if (id) ids.add(String(id));
  }
  return ids;
}

/** Propriétaires par carte : un compte ne compte qu'une fois, même avec plusieurs exemplaires. */
export function ownerCounts(collections: Record<string, readonly string[] | null>) {
  const counts: Record<string, number> = {};
  for (const ids of Object.values(collections)) {
    for (const id of new Set(ids ?? [])) counts[id] = (counts[id] ?? 0) + 1;
  }
  return counts;
}

/** Métriques d'un compte. `profile` = réponse de /api/users/:id, `ids` = cartes possédées ou null. */
export function accountMetrics(
  profile: unknown,
  ids: readonly string[] | null,
  prices: ReadonlyMap<string, number> | null,
  catalog: readonly CatalogCard[],
) {
  const p = record(profile);
  const owned = num(p.owned);
  const doubles = num(p.doublesCount);
  const progress = ids ? seriesProgress(ids, catalog) : null;
  const valued = ids && prices ? collectionValue(ids, prices) : null;
  const byRarity: Record<string, number> = {};
  for (const [code, value] of Object.entries(record(p.byRarity))) {
    const n = num(value);
    if (n !== null) byRarity[rarityOf(code)] = n;
  }
  return {
    owned,
    doubles,
    copies: owned !== null && doubles !== null ? owned + doubles : null,
    boosters: num(p.boostersOpened),
    listings: Array.isArray(p.listings) ? p.listings.length : num(p.listings),
    catalogSize: num(p.catalogSize),
    byRarity,
    mythic: byRarity.M ?? null,
    legendary: byRarity.L ?? null,
    value: valued ? valued.value : null,
    valuePriced: valued ? valued.priced : 0,
    valueUnpriced: valued ? valued.unpriced : 0,
    seriesFinished: progress ? progress.finished : null,
    seriesAlmost: progress ? progress.almost : null,
  };
}

export function columnOf(key: string): Column {
  return STAT_COLUMNS.find((c) => c.key === key) ?? (STAT_COLUMNS[0] as Column);
}

export function columnValue(account: Account, key: ColumnKey): number | null {
  if (key === 'catalogPct') {
    if (account.owned === null || !account.catalogSize) return null;
    return Math.round((account.owned / account.catalogSize) * 1000) / 10;
  }
  const value = account[key];
  return value === null ? null : Number(value);
}

/** Tri des comptes : les valeurs absentes passent toujours en dernier, dans les deux sens. */
export function sortAccounts(accounts: readonly Account[], key: ColumnKey, bestFirst = true) {
  const column = columnOf(key);
  const ascending = column.asc ? bestFirst : !bestFirst;
  return [...accounts].sort((a, b) => {
    const va = columnValue(a, column.key);
    const vb = columnValue(b, column.key);
    if (va === null && vb === null) return a.pseudo.localeCompare(b.pseudo, 'fr');
    if (va === null) return 1;
    if (vb === null) return -1;
    if (va !== vb) return ascending ? va - vb : vb - va;
    return a.pseudo.localeCompare(b.pseudo, 'fr');
  });
}

/** Rang de chaque ligne, ex æquo compris (1, 1, 3). Un compte non classable n'a pas de rang. */
export function rankRows(accounts: readonly Account[], key: ColumnKey, bestFirst = true) {
  const ranks = new Map<string, number | null>();
  let previous: number | null = null;
  let rank = 0;
  sortAccounts(accounts, key, bestFirst).forEach((row, index) => {
    const value = columnValue(row, key);
    if (value === null) {
      ranks.set(row.id, null);
      return;
    }
    if (previous === null || value !== previous) {
      rank = index + 1;
      previous = value;
    }
    ranks.set(row.id, rank);
  });
  return ranks;
}

export interface Slice {
  label: string;
  value: number;
  pct: number;
  color: string;
}

/** 50 teintes réparties par angle d'or, pour rester distinctes. */
export const PIE_COLORS = Array.from({ length: 50 }, (_, index) => {
  const hue = Math.round((index * 137.508) % 360);
  return `hsl(${hue}, 78%, ${index % 2 ? 62 : 56}%)`;
});

const BUCKETS: Partial<Record<ColumnKey, [string, (v: number | null) => boolean][]>> = {
  rankPos: [
    ['Top 100', (v) => v !== null && v <= 100],
    ['101 – 1 000', (v) => v !== null && v > 100 && v <= 1000],
    ['1 001 – 10 000', (v) => v !== null && v > 1000 && v <= 10000],
    ['> 10 000', (v) => v !== null && v > 10000],
    ['Non classé', (v) => v === null],
  ],
  catalogPct: [
    ['≥ 80 %', (v) => v !== null && v >= 80],
    ['50 – 79 %', (v) => v !== null && v >= 50 && v < 80],
    ['20 – 49 %', (v) => v !== null && v >= 20 && v < 50],
    ['< 20 %', (v) => v !== null && v < 20],
    ['Non calculable', (v) => v === null],
  ],
};

/**
 * Parts du camembert. Rang et complétion ne s'additionnent pas : ils sont montrés par tranches
 * (un compte dans une seule tranche). Les autres critères sont des parts du total.
 */
export function pieSlices(rows: readonly Account[], key: ColumnKey) {
  const buckets = BUCKETS[key];
  if (buckets) {
    const values = rows.map((row) => columnValue(row, key));
    const slices: Slice[] = buckets
      .map(([label, test], index) => {
        const count = values.filter(test).length;
        return {
          label,
          value: count,
          pct: rows.length ? (count / rows.length) * 100 : 0,
          color: PIE_COLORS[index] as string,
        };
      })
      .filter((slice) => slice.value > 0);
    return { mode: 'buckets' as const, slices, total: rows.length };
  }

  const entries = rows
    .map((row) => ({ row, value: columnValue(row, key) }))
    .sort((a, b) => (b.value ?? -1) - (a.value ?? -1));
  const total = entries.reduce(
    (sum, e) => sum + (e.value !== null && e.value > 0 ? e.value : 0),
    0,
  );
  const slices: Slice[] = entries.map((entry, index) => ({
    label: entry.row.pseudo,
    value: entry.value ?? 0,
    pct: total && entry.value !== null && entry.value > 0 ? (entry.value / total) * 100 : 0,
    color: PIE_COLORS[index % PIE_COLORS.length] as string,
  }));
  return { mode: 'accounts' as const, slices, total };
}
