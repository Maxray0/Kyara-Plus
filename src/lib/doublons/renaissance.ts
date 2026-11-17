import type { Api } from './market';
import { call } from './market';
import { MARKET_PAGE_DELAY_MS, normalizeListings } from './market-search';

/**
 * Renaissance : lecture seule de la progression du compte (`GET /api/me/renaissance`)
 * et estimation locale de ce que coûtent les cartes manquantes au plus bas du marché.
 * Aucune écriture, aucun ordre d'achat : ce module ne fait que lire.
 */

/** Clés de condition renvoyées par Kyara → rareté de carte. */
const KEY_TO_RARITY: Record<string, string> = {
  C: 'C',
  U: 'U',
  R: 'R',
  E: 'E',
  legendaries: 'L',
  mythics: 'M',
};

export const CARD_RARITY_LABEL: Record<string, string> = {
  C: 'Communes',
  U: 'Peu communes',
  R: 'Rares',
  E: 'Épiques',
  L: 'Légendaires',
  M: 'Mythiques',
};

/** Ordre d'affichage des raretés, du plus courant au plus rare. */
export const RARITY_ORDER = ['C', 'U', 'R', 'E', 'L', 'M'] as const;

/** Conditions qui ne sont pas des cartes : libellé et conseil en clair. */
const OTHER_CONDITIONS: Record<string, readonly [string, string]> = {
  boosters: ['Boosters ouverts', 'Continue d’ouvrir des boosters (les gratuits comptent).'],
  wait: [
    'Délai depuis la Renaissance',
    'La Renaissance ne redevient possible qu’après le délai fixé par Kyara.',
  ],
  escrow: [
    'Rien en cours sur le marché',
    'Termine ou retire tes annonces, offres et échanges en cours : les cartes bloquées dedans empêchent la Renaissance.',
  ],
  discord: ['Compte Discord lié', 'Lie ton compte Discord depuis ton profil Kyara.'],
  trust: ['Compte de confiance', 'Condition gérée par Kyara (ancienneté, activité normale).'],
  ban: ['Aucune sanction', 'Condition gérée par Kyara.'],
};

export interface RenaissanceRequirement {
  key: string;
  ok: boolean;
  /** Cartes possédées de cette rareté, quand le site les donne. */
  have: number | null;
  /** Cartes demandées pour cette rareté (ou compteur pour les boosters). */
  need: number | null;
  /** Rareté concernée (`C`…`M`), `null` pour les autres conditions. */
  rarity: string | null;
  label: string;
  hint: string;
  /** Cartes encore à obtenir ; 0 hors conditions de cartes. */
  missing: number;
}

export interface RenaissanceState {
  level: number;
  eligible: boolean;
  waitUntil: string | null;
  requirements: RenaissanceRequirement[];
  cardRequirements: RenaissanceRequirement[];
  otherRequirements: RenaissanceRequirement[];
  /** Conditions remplies et total, pour « x / y ». */
  done: number;
  total: number;
  missingCards: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

function countOrNull(value: unknown): number | null {
  const number = typeof value === 'string' ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number) && number >= 0
    ? Math.trunc(number)
    : null;
}

function dateOrNull(value: unknown): string | null {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
}

/**
 * Lit la réponse de `/api/me/renaissance` sans rien inventer : une condition sans
 * `key` ou une forme inattendue est ignorée plutôt que devinée.
 */
export function normalizeRenaissance(data: unknown): RenaissanceState {
  const root = isRecord(data) ? data : {};
  const raw = Array.isArray(root.requirements) ? root.requirements : [];
  const requirements: RenaissanceRequirement[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const key = typeof item.key === 'string' ? item.key.trim() : '';
    if (!key) continue;
    const rarity = KEY_TO_RARITY[key] ?? null;
    const have = countOrNull(item.have);
    const need = countOrNull(item.need);
    const missing = rarity && need !== null ? Math.max(0, need - (have ?? 0)) : 0;
    const [label, hint] = rarity
      ? [CARD_RARITY_LABEL[rarity] ?? key, '']
      : (OTHER_CONDITIONS[key] ?? [key, '']);
    requirements.push({ key, ok: item.ok === true, have, need, rarity, label, hint, missing });
  }
  const cardRequirements = requirements
    .filter((requirement) => requirement.rarity)
    .sort(
      (a, b) =>
        RARITY_ORDER.indexOf(a.rarity as (typeof RARITY_ORDER)[number]) -
        RARITY_ORDER.indexOf(b.rarity as (typeof RARITY_ORDER)[number]),
    );
  return {
    level: countOrNull(root.level) ?? 0,
    eligible: root.eligible === true,
    waitUntil: dateOrNull(root.waitUntil),
    requirements,
    cardRequirements,
    otherRequirements: requirements.filter((requirement) => !requirement.rarity),
    done: requirements.filter((requirement) => requirement.ok).length,
    total: requirements.length,
    missingCards: cardRequirements.reduce((sum, requirement) => sum + requirement.missing, 0),
  };
}

export interface RarityCost {
  rarity: string;
  /** Cartes manquantes visées. */
  missing: number;
  /** Coût au plus bas du marché, `null` quand aucune annonce n'a été trouvée. */
  cost: number | null;
  /** Cartes différentes effectivement chiffrées. */
  listed: number;
  /** Vrai quand des cartes ont été complétées au prix de la plus chère trouvée. */
  padded: boolean;
  /** Vrai quand le marché n'a pas montré assez d'annonces ou qu'une page a échoué. */
  partial: boolean;
  failed: boolean;
}

export interface RenaissanceEstimate {
  byRarity: RarityCost[];
  /** Somme des raretés chiffrées. */
  total: number;
  missing: number;
  partial: boolean;
  /** Vrai dès qu'une rareté a complété des cartes au prix le plus haut trouvé. */
  padded: boolean;
  failures: number;
}

/** Prix minimum autorisé par Kyara par rareté (15 ◆ dès Épique). */
const RARITY_FLOOR: Record<string, number> = { E: 15, L: 15, M: 15 };

/** Minorant gratuit : cartes manquantes × prix plancher de leur rareté. */
export function floorCost(requirements: readonly RenaissanceRequirement[]): number {
  return requirements.reduce(
    (sum, requirement) =>
      requirement.ok ? sum : sum + requirement.missing * (RARITY_FLOOR[requirement.rarity ?? ''] ?? 1),
    0,
  );
}

/** Annonces lues par page pour l'estimation (le site en sert 50 au plus). */
export const RENAISSANCE_COST_PAGE_SIZE = 50;
/** Pages lues au plus par rareté. */
export const RENAISSANCE_COST_PAGES = 2;

/** Chemin des annonces à prix fixe les moins chères, sur les cartes que je n'ai pas. */
export function renaissanceCostPath(
  rarity: string,
  page: number,
  pageSize = RENAISSANCE_COST_PAGE_SIZE,
): string {
  return (
    `/api/market/listings?type=fixed&sort=price_asc&missing=1` +
    `&rarity=${encodeURIComponent(rarity)}&page=${Math.max(1, Math.trunc(page))}` +
    `&pageSize=${Math.max(1, Math.trunc(pageSize))}`
  );
}

export interface CostOptions {
  pages?: number;
  pageSize?: number;
  wait?: (ms: number) => Promise<void>;
}

/**
 * Coût des `missing` cartes les plus abordables : une annonce par carte (la moins
 * chère), sans compter deux fois la même carte. Si le marché en montre moins, le
 * reste est compté au prix de la plus chère trouvée (`padded`), et l'estimation
 * est marquée `partial` (« ≈ » à l'affichage).
 */
export async function estimateRarityCost(
  api: Api,
  rarity: string,
  missing: number,
  options: CostOptions = {},
): Promise<RarityCost> {
  const pages = Math.max(1, Math.trunc(options.pages ?? RENAISSANCE_COST_PAGES));
  const pageSize = Math.max(1, Math.trunc(options.pageSize ?? RENAISSANCE_COST_PAGE_SIZE));
  const wait = options.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const wanted = Math.max(0, Math.trunc(missing));
  if (!wanted) {
    return { rarity, missing: 0, cost: 0, listed: 0, padded: false, partial: false, failed: false };
  }

  const cheapest = new Map<number, number>();
  let failed = false;
  for (let page = 1; page <= pages; page += 1) {
    let listings;
    try {
      const result = await call(api, renaissanceCostPath(rarity, page, pageSize));
      if (!result.ok) {
        failed = true;
        break;
      }
      listings = normalizeListings(result.data);
    } catch {
      failed = true;
      break;
    }
    for (const listing of listings) {
      if (!Number.isFinite(listing.price) || listing.price <= 0) continue;
      const seen = cheapest.get(listing.characterId);
      if (seen === undefined || listing.price < seen) cheapest.set(listing.characterId, listing.price);
    }
    if (cheapest.size >= wanted || listings.length < pageSize) break;
    await wait(MARKET_PAGE_DELAY_MS);
  }

  const found = [...cheapest.values()].sort((a, b) => a - b).slice(0, wanted);
  if (!found.length) {
    return { rarity, missing: wanted, cost: null, listed: 0, padded: false, partial: true, failed };
  }
  const sum = found.reduce((total, price) => total + price, 0);
  const highest = found.at(-1) ?? 0;
  const rest = wanted - found.length;
  return {
    rarity,
    missing: wanted,
    cost: sum + rest * highest,
    listed: found.length,
    padded: rest > 0,
    partial: rest > 0 || failed,
    failed,
  };
}

/**
 * Estimation progressive : les conditions s'affichent tout de suite, puis chaque
 * rareté est chiffrée et notifiée à l'écran dès qu'elle arrive. `start` est
 * idempotent, donc un retour sur l'onglet ne relance pas les lectures.
 */
export interface LiveRenaissanceEstimate extends RenaissanceEstimate {
  done: boolean;
  start: () => Promise<void>;
  onChange: (listener: () => void) => () => void;
}

export function createLiveEstimate(
  api: Api,
  requirements: readonly RenaissanceRequirement[],
  options: CostOptions & { waitBetween?: (ms: number) => Promise<void> } = {},
): LiveRenaissanceEstimate {
  const waitBetween =
    options.waitBetween ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const targets = requirements.filter(
    (requirement) => requirement.rarity && !requirement.ok && requirement.missing > 0,
  );
  const listeners = new Set<() => void>();
  let run: Promise<void> | null = null;
  let finished = false;
  const estimate: LiveRenaissanceEstimate = {
    byRarity: [],
    total: 0,
    missing: targets.reduce((sum, requirement) => sum + requirement.missing, 0),
    partial: false,
    padded: false,
    failures: 0,
    done: false,
    onChange(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    start() {
      if (finished) return Promise.resolve();
      if (run) return run;
      run = (async () => {
        for (const [index, requirement] of targets.entries()) {
          const row = await estimateRarityCost(
            api,
            requirement.rarity as string,
            requirement.missing,
            options,
          );
          estimate.byRarity.push(row);
          estimate.total += row.cost ?? 0;
          if (row.partial) estimate.partial = true;
          if (row.padded) estimate.padded = true;
          if (row.failed) estimate.failures += 1;
          for (const listener of [...listeners]) listener();
          if (index < targets.length - 1) await waitBetween(MARKET_PAGE_DELAY_MS);
        }
        estimate.done = true;
        finished = true;
        for (const listener of [...listeners]) listener();
      })();
      return run;
    },
  };
  if (!targets.length) {
    estimate.done = true;
    finished = true;
  }
  return estimate;
}

/** Lit la progression réelle du compte ; une erreur d'API remonte telle quelle. */
export async function fetchRenaissance(api: Api): Promise<RenaissanceState> {
  const result = await call(api, '/api/me/renaissance');
  if (!result.ok) throw new Error(`Renaissance : ${result.message}`);
  return normalizeRenaissance(result.data);
}
