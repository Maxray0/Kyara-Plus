import type { CatalogCard } from '../stats/model';

/**
 * Albums : progression par série à partir du catalogue déjà en cache et des quantités
 * de la collection. Tout est calculé localement, sans requête supplémentaire, et la
 * vitrine est un simple texte copiable — rien n'est envoyé.
 */

export interface AlbumSummary {
  series: string;
  /** Cartes connues du catalogue dans cette série. */
  total: number;
  /** Cartes possédées au moins une fois. */
  owned: number;
  missing: number;
  /** Part possédée, en % arrondi. */
  pct: number;
  complete: boolean;
  /** Exemplaires au-delà du premier. */
  duplicates: number;
}

/** Nombre minimum de cartes d'un album pour ouvrir droit à sa récompense. */
export const ALBUM_REWARD_CARDS = 5;

export type AlbumSort = 'progress' | 'missing';

/**
 * Tri d'affichage : par défaut la progression, albums complets toujours en bas ; ou ce
 * qu'il reste à compléter d'abord (le moins de cartes manquantes en tête).
 */
export function sortAlbums(
  albums: readonly AlbumSummary[],
  mode: AlbumSort = 'progress',
): AlbumSummary[] {
  // Les albums d'au moins cinq cartes (récompense possible) passent avant les petits,
  // et les albums complets ferment chaque groupe.
  const group = (album: AlbumSummary): number => {
    const reward = album.total >= ALBUM_REWARD_CARDS;
    if (reward) return album.complete ? 1 : 0;
    return album.complete ? 3 : 2;
  };
  return [...albums].sort((a, b) => {
    const order = group(a) - group(b);
    if (order) return order;
    if (mode === 'missing' && a.missing !== b.missing) return a.missing - b.missing;
    return (
      b.pct - a.pct ||
      a.missing - b.missing ||
      a.series.localeCompare(b.series, 'fr')
    );
  });
}

/** Un album d'au moins cinq cartes peut rapporter la récompense d'album. */
export function rewardAlbum(album: AlbumSummary): boolean {
  return album.total >= ALBUM_REWARD_CARDS;
}

export interface AlbumCard {
  id: number;
  name: string;
  rarity: string;
  owned: boolean;
  wished: boolean;
}

const RARITY_ORDER: Record<string, number> = { M: 0, L: 1, S: 1, E: 2, R: 3, U: 4, C: 5 };

/** Cartes d'un album, dans l'ordre de rareté puis de nom, avec possession et envie. */
export function albumCards(
  catalog: readonly CatalogCard[],
  owned: ReadonlyMap<number, number>,
  series: string,
  wished: ReadonlySet<number> = new Set(),
): AlbumCard[] {
  const cards: AlbumCard[] = [];
  const seen = new Set<number>();
  for (const card of catalog) {
    if (String(card.series ?? '').trim() !== series) continue;
    const id = Number(card.id);
    if (!Number.isSafeInteger(id) || id < 1 || seen.has(id)) continue;
    seen.add(id);
    cards.push({
      id,
      name: card.name || `Carte #${id}`,
      rarity: String(card.rarity ?? '').toUpperCase(),
      owned: (owned.get(id) ?? 0) > 0,
      wished: wished.has(id),
    });
  }
  return cards.sort(
    (a, b) =>
      (RARITY_ORDER[a.rarity] ?? 9) - (RARITY_ORDER[b.rarity] ?? 9) ||
      a.name.localeCompare(b.name, 'fr'),
  );
}

export interface AlbumTotals {
  albums: number;
  complete: number;
  cards: number;
  owned: number;
  missing: number;
  duplicates: number;
}

/** Nombre lisible sans dépendre de l'ICU : 1234 → « 1 234 ». */
export function formatCount(value: number): string {
  const rounded = Math.max(0, Math.round(value));
  return String(rounded).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/**
 * Regroupe le catalogue par série et compte les cartes possédées. Une série vide est
 * ignorée (le catalogue contient aussi des cartes hors album). Les albums les plus
 * avancés passent en premier, puis ceux qui manquent le moins de cartes.
 */
export function buildAlbums(
  catalog: readonly CatalogCard[],
  owned: ReadonlyMap<number, number>,
  options: { minTotal?: number } = {},
): AlbumSummary[] {
  const minTotal = Math.max(1, Math.trunc(options.minTotal ?? 1));
  const groups = new Map<string, { total: Set<number>; owned: Set<number>; duplicates: number }>();
  for (const card of catalog) {
    const series = String(card.series ?? '').trim();
    if (!series) continue;
    const id = Number(card.id);
    if (!Number.isSafeInteger(id) || id < 1) continue;
    const group = groups.get(series) ?? { total: new Set<number>(), owned: new Set<number>(), duplicates: 0 };
    if (group.total.has(id)) continue;
    group.total.add(id);
    const qty = owned.get(id) ?? 0;
    if (qty > 0) {
      group.owned.add(id);
      group.duplicates += Math.max(0, qty - 1);
    }
    groups.set(series, group);
  }

  const albums: AlbumSummary[] = [];
  for (const [series, group] of groups) {
    const total = group.total.size;
    if (total < minTotal) continue;
    const found = group.owned.size;
    albums.push({
      series,
      total,
      owned: found,
      missing: total - found,
      pct: Math.round((found / total) * 100),
      complete: found === total,
      duplicates: group.duplicates,
    });
  }
  return albums.sort(
    (a, b) => b.pct - a.pct || a.missing - b.missing || a.series.localeCompare(b.series, 'fr'),
  );
}

export function albumTotals(albums: readonly AlbumSummary[]): AlbumTotals {
  const totals: AlbumTotals = { albums: 0, complete: 0, cards: 0, owned: 0, missing: 0, duplicates: 0 };
  for (const album of albums) {
    totals.albums += 1;
    if (album.complete) totals.complete += 1;
    totals.cards += album.total;
    totals.owned += album.owned;
    totals.missing += album.missing;
    totals.duplicates += album.duplicates;
  }
  return totals;
}

/** Vitrine à partager : bilan lisible et albums les plus proches du but. */
export function showcaseText(
  albums: readonly AlbumSummary[],
  totals: AlbumTotals,
  options: { limit?: number; pseudo?: string | null } = {},
): string {
  const limit = Math.max(0, Math.trunc(options.limit ?? 5));
  const lines = [`Ma collection Kyara${options.pseudo ? ` — ${options.pseudo}` : ''}`];
  lines.push(
    `${formatCount(totals.owned)} / ${formatCount(totals.cards)} cartes · ${formatCount(totals.complete)} album(s) complet(s) sur ${formatCount(totals.albums)} · ${formatCount(totals.duplicates)} doublon(s)`,
  );
  const near = albums.filter((album) => !album.complete).slice(0, limit);
  if (near.length) {
    lines.push('Presque finis :');
    for (const album of near) {
      lines.push(
        `- ${album.series} : ${album.owned}/${album.total} (${album.missing} manquante${album.missing > 1 ? 's' : ''})`,
      );
    }
  } else if (albums.length) {
    lines.push('Tous les albums suivis sont complets.');
  } else {
    lines.push('Aucun album connu : le catalogue n’a pas encore été lu.');
  }
  lines.push('Vitrine générée localement par Kyara Plus — aucune donnée envoyée.');
  return lines.join('\n');
}
