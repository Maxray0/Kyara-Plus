import { storage } from 'wxt/utils/storage';

/**
 * Historique local des boosters ouverts (manuels ou automatiques) avec les cartes tirées.
 * Le panneau s'en sert pour l'onglet Activité → Boosters. Aucune écriture sur Kyara.
 *
 * Le journal des ouvertures est plafonné pour ne pas remplir le stockage ; les totaux et le
 * cumul par carte sont conservés à part, sinon les compteurs se figent au plafond.
 */

export interface PackHistoryCard {
  name: string;
  rarity: string | null;
  /** Identifiant de la carte chez Kyara, quand la réponse le donne (sert à l'image). */
  id: number | null;
}

export interface PackHistoryEntry {
  at: number;
  packId: string;
  packName: string;
  cards: PackHistoryCard[];
}

/** Une carte obtenue, cumulée depuis la première ouverture. */
export interface PackHistoryCardTotal extends PackHistoryCard {
  count: number;
  lastAt: number;
  packName: string;
}

export interface PackHistoryTotals {
  opened: number;
  cards: number;
  byCard: PackHistoryCardTotal[];
}

/** Ouvertures conservées : au-delà, les plus anciennes sortent du journal (pas des totaux). */
export const PACK_HISTORY_MAX = 300;

export const packHistoryItem = storage.defineItem<PackHistoryEntry[]>('local:packHistory', {
  fallback: [],
  version: 1,
});

export const packHistoryTotalsItem = storage.defineItem<PackHistoryTotals | null>(
  'local:packHistoryTotals',
  { fallback: null, version: 1 },
);

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const cleanRarity = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

const cleanId = (value: unknown): number | null => {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
};

function cleanCards(value: unknown): PackHistoryCard[] {
  if (!Array.isArray(value)) return [];
  const cards: PackHistoryCard[] = [];
  for (const item of value) {
    const card = record(item);
    const name = typeof card.name === 'string' ? card.name.trim() : '';
    if (!name) continue;
    cards.push({ name, rarity: cleanRarity(card.rarity), id: cleanId(card.id) });
  }
  return cards;
}

export function normalizePackHistory(raw: unknown): PackHistoryEntry[] {
  if (!Array.isArray(raw)) return [];
  const entries: PackHistoryEntry[] = [];
  for (const item of raw) {
    const entry = record(item);
    const at = Number(entry.at);
    const packName = typeof entry.packName === 'string' ? entry.packName.trim() : '';
    if (!Number.isFinite(at) || at <= 0 || !packName) continue;
    entries.push({
      at,
      packId: typeof entry.packId === 'string' ? entry.packId : '',
      packName,
      cards: cleanCards(entry.cards),
    });
  }
  return entries.slice(-PACK_HISTORY_MAX);
}

function cleanTotalsCards(value: unknown): PackHistoryCardTotal[] {
  if (!Array.isArray(value)) return [];
  const cards: PackHistoryCardTotal[] = [];
  for (const item of value) {
    const card = record(item);
    const name = typeof card.name === 'string' ? card.name.trim() : '';
    const count = Math.floor(Number(card.count));
    if (!name || !Number.isFinite(count) || count <= 0) continue;
    const lastAt = Number(card.lastAt);
    cards.push({
      name,
      rarity: cleanRarity(card.rarity),
      id: cleanId(card.id),
      count,
      lastAt: Number.isFinite(lastAt) && lastAt > 0 ? lastAt : 0,
      packName: typeof card.packName === 'string' ? card.packName : '',
    });
  }
  return cards;
}

export function normalizePackHistoryTotals(raw: unknown): PackHistoryTotals | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = record(raw);
  const opened = Math.floor(Number(value.opened));
  const cards = Math.floor(Number(value.cards));
  if (!Number.isFinite(opened) || opened < 0) return null;
  if (!Number.isFinite(cards) || cards < 0) return null;
  return { opened, cards, byCard: cleanTotalsCards(value.byCard) };
}

const cardKey = (card: PackHistoryCard): string =>
  `${card.id ?? ''}|${card.name.toLowerCase()}|${(card.rarity ?? '').toUpperCase()}`;

/** Ajoute une ouverture aux totaux, sans plafond. */
export function addPackHistoryTotals(
  base: PackHistoryTotals,
  entry: Pick<PackHistoryEntry, 'at' | 'packName' | 'cards'>,
): PackHistoryTotals {
  const byCard = new Map<string, PackHistoryCardTotal>();
  for (const card of base.byCard) byCard.set(cardKey(card), card);
  for (const card of entry.cards) {
    const key = cardKey(card);
    const current = byCard.get(key);
    byCard.set(
      key,
      current
        ? {
            ...current,
            id: current.id ?? card.id,
            count: current.count + 1,
            lastAt: Math.max(current.lastAt, entry.at),
            packName: entry.at >= current.lastAt ? entry.packName : current.packName,
          }
        : { ...card, count: 1, lastAt: entry.at, packName: entry.packName },
    );
  }
  return {
    opened: base.opened + 1,
    cards: base.cards + entry.cards.length,
    byCard: [...byCard.values()],
  };
}

/** Totaux reconstruits depuis le journal conservé (première lecture après mise à jour). */
export function totalsFromEntries(entries: readonly PackHistoryEntry[]): PackHistoryTotals {
  return entries.reduce<PackHistoryTotals>(
    (totals, entry) => addPackHistoryTotals(totals, entry),
    { opened: 0, cards: 0, byCard: [] },
  );
}

let chain: Promise<void> = Promise.resolve();

/** Ajoute une ouverture au journal (plafonné) et aux totaux (jamais plafonnés). */
export function appendPackHistory(
  entry: Omit<PackHistoryEntry, 'at'>,
  now = Date.now(),
): Promise<void> {
  const clean = normalizePackHistory([{ ...entry, at: now }])[0];
  if (!clean) return Promise.resolve();
  chain = chain
    .then(async () => {
      const entries = normalizePackHistory(await packHistoryItem.getValue());
      const stored = normalizePackHistoryTotals(await packHistoryTotalsItem.getValue());
      const totals = stored ?? totalsFromEntries(entries);
      await packHistoryTotalsItem.setValue(addPackHistoryTotals(totals, clean));
      await packHistoryItem.setValue([...entries, clean].slice(-PACK_HISTORY_MAX));
    })
    .catch(() => undefined);
  return chain;
}

/** Historique trié du plus ancien au plus récent. */
export async function getPackHistory(): Promise<PackHistoryEntry[]> {
  try {
    return normalizePackHistory(await packHistoryItem.getValue());
  } catch {
    return [];
  }
}

/** Cumul à vie des ouvertures et des cartes obtenues, indépendant du journal conservé. */
export async function getPackHistoryTotals(): Promise<PackHistoryTotals> {
  try {
    const stored = normalizePackHistoryTotals(await packHistoryTotalsItem.getValue());
    return stored ?? totalsFromEntries(await getPackHistory());
  } catch {
    return { opened: 0, cards: 0, byCard: [] };
  }
}

/** Cartes tirées dans une réponse `open-many` (nom, rareté et id, sans rien inventer). */
export function cardsFromResults(results: unknown): PackHistoryCard[] {
  if (!Array.isArray(results)) return [];
  const cards: PackHistoryCard[] = [];
  for (const result of results) {
    const list = record(result).cards;
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      const card = record(item);
      const character = record(card.character);
      const rawName = character.name ?? card.name;
      const name = typeof rawName === 'string' && rawName.trim() ? rawName.trim() : '';
      if (!name) continue;
      const rarity = character.rarity ?? card.rarity;
      cards.push({
        name,
        rarity: typeof rarity === 'string' && rarity ? rarity : null,
        id: cleanId(character.id ?? card.characterId ?? card.id),
      });
    }
  }
  return cards;
}

const RARITY_ORDER = ['M', 'L', 'E', 'R', 'U', 'C'];

/** Rang de rareté : mythique d'abord, puis légendaire, épique, rare, peu commune, commune. */
export function rarityRank(rarity: string | null): number {
  const code = rarity?.trim().toUpperCase() ?? '';
  const index = RARITY_ORDER.indexOf(code);
  return index === -1 ? RARITY_ORDER.length : index;
}
