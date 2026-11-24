import { ApiError, AuthError, PassRequiredError, type ApiClient } from '../api';
import type { PackInfo } from './packs';

/**
 * Ouverture d'un booster depuis le panneau : une seule ouverture, au prix affiché
 * (`maxChakra` = prix du pack), après confirmation par deux vrais clics. Le site reste
 * l'autorité : un refus est rendu tel quel, sans réessai automatique.
 */

export type Api = Pick<ApiClient, 'request'>;

/** Délai large : l'ouverture renvoie plusieurs cartes d'un coup. */
export const PACK_OPEN_TIMEOUT_MS = 45_000;

export interface PackOpenCard {
  name: string;
  rarity: string | null;
  /** Identifiant de la carte chez Kyara, quand la réponse le donne (sert à l'image). */
  id: number | null;
}

export interface PackOpenResult {
  ok: boolean;
  cards: PackOpenCard[];
  message: string;
}

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

export function stoppedReason(data: unknown): string | null {
  const stopped = record(data).stopped;
  if (typeof stopped === 'string' && stopped.trim()) return stopped.trim();
  return null;
}

/** Cartes réellement tirées, dans l'ordre renvoyé par Kyara. */
export function openCards(data: unknown): PackOpenCard[] {
  const source = record(data);
  const results = Array.isArray(source.results) ? source.results : [];
  const cards: PackOpenCard[] = [];
  for (const result of results) {
    const list = Array.isArray(record(result).cards) ? (record(result).cards as unknown[]) : [];
    for (const item of list) {
      const card = record(item);
      const character = record(card.character);
      const name = character.name ?? card.name;
      if (typeof name !== 'string' || !name.trim()) continue;
      const rarity = character.rarity ?? card.rarity;
      const id = Number(character.id ?? card.characterId ?? card.id);
      cards.push({
        name: name.trim(),
        rarity: typeof rarity === 'string' ? rarity : null,
        id: Number.isInteger(id) && id > 0 ? id : null,
      });
    }
  }
  return cards;
}

/** Prix maximal accepté pour une ouverture : jamais plus que le prix annoncé. */
export function maxChakraFor(pack: PackInfo): number {
  return Number.isFinite(pack.price) && pack.price > 0 ? Math.round(pack.price) : 0;
}

export async function openPack(api: Api, pack: PackInfo): Promise<PackOpenResult> {
  try {
    const data = await api.request<unknown>(
      `/api/packs/${encodeURIComponent(pack.id)}/open-many`,
      {
        method: 'POST',
        body: { count: 1, maxChakra: maxChakraFor(pack) },
        timeoutMs: PACK_OPEN_TIMEOUT_MS,
      },
    );
    const cards = openCards(data);
    if (!cards.length) {
      const why = stoppedReason(data);
      return {
        ok: false,
        cards: [],
        message: why
          ? `Aucune ouverture : ${why}.`
          : 'Aucune carte renvoyée par Kyara ; rien n’est compté.',
      };
    }
    const names = cards.map((card) => card.name);
    return {
      ok: true,
      cards,
      message: `${cards.length} carte(s) : ${names.slice(0, 4).join(', ')}${
        names.length > 4 ? ` (+${names.length - 4})` : ''
      }.`,
    };
  } catch (error) {
    if (error instanceof AuthError || error instanceof PassRequiredError) throw error;
    if (error instanceof ApiError) {
      return {
        ok: false,
        cards: [],
        message: error.message || `Kyara a refusé l’ouverture (HTTP ${error.status}).`,
      };
    }
    throw error;
  }
}
