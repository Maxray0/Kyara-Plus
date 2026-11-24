import { storage } from 'wxt/utils/storage';

/**
 * Dernière recherche du panneau « Chercher dans le marché » : critères, tri et page de
 * reprise. Le panneau repartait de zéro à chaque ouverture, y compris après une lecture
 * partielle de plusieurs minutes ; ces préférences rendent la reprise immédiate et ne
 * contiennent aucune donnée de jeu, seulement la saisie de l'utilisateur.
 */

export interface MarketSearchPrefs {
  text: string;
  series: string;
  rarity: string;
  sort: 'newest' | 'ending';
  noAuction: boolean;
  wishOnly: boolean;
  missing: boolean;
  buyNow: boolean;
  minDiscount: number;
  hideOwned: boolean;
  /** Page où reprendre la prochaine lecture ; 1 repart du début. */
  nextPage: number;
  /** Pages déjà lues, pour l'affichage de la couverture au retour. */
  pages: number;
  /** Instant du dernier enregistrement. */
  at: number;
}

/** Au-delà, une page de reprise ne veut plus dire grand-chose : on repart du début. */
export const MARKET_PREFS_RESUME_MS = 12 * 3_600_000;

export const EMPTY_MARKET_PREFS: MarketSearchPrefs = {
  text: '',
  series: '',
  rarity: '',
  sort: 'newest',
  noAuction: false,
  wishOnly: false,
  missing: false,
  buyNow: false,
  minDiscount: 0,
  hideOwned: false,
  nextPage: 1,
  pages: 0,
  at: 0,
};

function text(value: unknown, max = 80): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function count(value: unknown): number {
  const number = Math.trunc(Number(value));
  return Number.isFinite(number) && number > 0 ? number : 0;
}

/** Relit les préférences sans faire confiance au stockage. */
export function normalizeMarketPrefs(raw: unknown): MarketSearchPrefs {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const at = Number(source.at);
  return {
    text: text(source.text),
    series: text(source.series),
    rarity: text(source.rarity, 4).toUpperCase(),
    sort: source.sort === 'ending' ? 'ending' : 'newest',
    noAuction: source.noAuction === true,
    wishOnly: source.wishOnly === true,
    missing: source.missing === true,
    buyNow: source.buyNow === true,
    minDiscount: Math.max(0, Math.min(100, Math.trunc(Number(source.minDiscount) || 0))),
    hideOwned: source.hideOwned === true,
    nextPage: Math.max(1, count(source.nextPage) || 1),
    pages: count(source.pages),
    at: Number.isFinite(at) && at > 0 ? at : 0,
  };
}

export const marketPrefsItem = storage.defineItem<MarketSearchPrefs>('local:marketSearch', {
  fallback: { ...EMPTY_MARKET_PREFS },
  version: 1,
});

export async function loadMarketPrefs(): Promise<MarketSearchPrefs> {
  return normalizeMarketPrefs(await marketPrefsItem.getValue().catch(() => null));
}

/** Enregistre les critères et la page de reprise (jamais plus d'une écriture par appel). */
export async function saveMarketPrefs(
  prefs: Partial<MarketSearchPrefs>,
  now = Date.now(),
): Promise<MarketSearchPrefs> {
  const next = normalizeMarketPrefs({ ...(await loadMarketPrefs()), ...prefs, at: now });
  await marketPrefsItem.setValue(next).catch(() => undefined);
  return next;
}

/** Page à reprendre : la suite d'une lecture récente, sinon le début. */
export function resumePage(prefs: MarketSearchPrefs, now = Date.now()): number {
  if (!prefs.at || now - prefs.at > MARKET_PREFS_RESUME_MS) return 1;
  return Math.max(1, prefs.nextPage);
}

/** Remet la recherche à zéro (bouton « Nouvelle recherche »). */
export async function resetMarketPrefs(
  keep: Partial<MarketSearchPrefs> = {},
  now = Date.now(),
): Promise<MarketSearchPrefs> {
  const next = normalizeMarketPrefs({ ...EMPTY_MARKET_PREFS, ...keep, at: now });
  await marketPrefsItem.setValue(next).catch(() => undefined);
  return next;
}
