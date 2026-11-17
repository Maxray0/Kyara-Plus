import {
  DEFAULT_RECYCLE,
  fetchCompetition,
  MARKET_RULES,
  minPrice,
  netFromSale,
  type MarketRules,
} from './advisor';
import type { Api } from './market';
import { MARKET_PAGE_DELAY_MS, searchMarket, type MarketListing } from './market-search';

/**
 * Bons plans (lecture seule) : lit les annonces à prix fixe les plus récentes, garde
 * celles nettement sous la médiane du site et vérifie, pour les meilleures, que la
 * revente reste possible sous l'annonce concurrente la moins chère.
 *
 * Rien n'est acheté : ce module ne fait que lire et calculer un bénéfice net après
 * frais (2 %) et taxe de vente (5 %).
 */

export interface DealScanOptions {
  /** Pages d'annonces récentes lues. */
  pages?: number;
  pageSize?: number;
  /** Annonces vérifiées une par une (une requête de concurrence chacune). */
  maxChecks?: number;
  /** Réduction minimale sous la médiane, en %. */
  minDiscount?: number;
  /** Ventes des 7 derniers jours exigées pour croire à une revente. */
  minSales7d?: number;
  /** Barème de frais lu dans `/api/config` ; repli sur `MARKET_RULES`. */
  rules?: MarketRules;
  /** Bénéfice net minimal, en ◆ : 1 par défaut, les frais rendent les petites cartes peu rentables. */
  minProfit?: number;
  wait?: (ms: number) => Promise<void>;
}

export interface Deal {
  listing: MarketListing;
  /** Annonce concurrente la moins chère, hors la mienne. */
  nextAsk: number | null;
  /** Prix de revente prudent : médiane, plafonnée sous la concurrence. */
  resale: number;
  /** Ce que rapporte la revente à ce prix, frais déduits. */
  net: number;
  /** Bénéfice net de l'opération (peut être négatif). */
  profit: number;
  /** Réduction sous la médiane, en %. */
  discount: number;
  /** L'annonce coûte moins que la valeur de recyclage : gain quasi garanti. */
  belowRecycle: boolean;
}

export interface DealScan {
  deals: Deal[];
  /** Annonces lues, toutes pages confondues. */
  scanned: number;
  pages: number;
  /** Annonces vérifiées une par une. */
  checks: number;
  /** Vérifications qui ont échoué (elles ne bloquent pas les autres). */
  errors: number;
}

/** Une annonce par carte, la moins chère, hors enchères sans achat immédiat. */
export function cheapestPerCard(listings: readonly MarketListing[]): MarketListing[] {
  const best = new Map<number, MarketListing>();
  for (const listing of listings) {
    if (listing.auction || listing.price <= 0) continue;
    const current = best.get(listing.characterId);
    if (!current || listing.price < current.price) best.set(listing.characterId, listing);
  }
  return [...best.values()];
}

/**
 * Bénéfice si l'on revend au prix prudent : la médiane, mais jamais au-dessus de
 * l'annonce concurrente la moins chère (moins 1 ◆), et jamais sous le prix plancher.
 */
export function dealFor(
  listing: MarketListing,
  nextAsk: number | null,
  recycle: Readonly<Record<string, number>> = DEFAULT_RECYCLE,
  rules: MarketRules = MARKET_RULES,
): Deal {
  const rarity = (listing.rarity ?? '').toUpperCase();
  const median = listing.median ?? 0;
  const resale = Math.max(
    minPrice(rarity),
    nextAsk !== null && nextAsk > 0 ? Math.min(median, nextAsk - 1) : median,
  );
  const net = netFromSale(resale, rules);
  return {
    listing,
    nextAsk,
    resale,
    net,
    profit: net - listing.price,
    discount: median > 0 ? Math.round((1 - listing.price / median) * 100) : 0,
    belowRecycle: listing.price < (recycle[rarity] ?? 0),
  };
}

/**
 * Lit les annonces récentes, présélectionne les meilleures réductions puis vérifie
 * la concurrence des `maxChecks` premières. Une vérification ratée est comptée et
 * ignorée, sans annuler le reste.
 */
export async function scanDeals(
  api: Api,
  recycle: Readonly<Record<string, number>> = DEFAULT_RECYCLE,
  options: DealScanOptions = {},
): Promise<DealScan> {
  const pages = Math.max(1, Math.trunc(options.pages ?? 2));
  const maxChecks = Math.max(1, Math.trunc(options.maxChecks ?? 4));
  const minDiscount = Math.max(0, Math.trunc(options.minDiscount ?? 25));
  const minSales7d = Math.max(0, Math.trunc(options.minSales7d ?? 3));
  const minProfit = Math.trunc(options.minProfit ?? 1);
  const rules = options.rules ?? MARKET_RULES;
  const wait = options.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  const market = await searchMarket(
    api,
    { sort: 'newest' },
    { maxPages: pages, pageSize: options.pageSize, wait },
  );

  const quick = cheapestPerCard(market.listings)
    .map((listing) => dealFor(listing, null, recycle, rules))
    .filter(
      (deal) =>
        deal.listing.median !== null &&
        (deal.belowRecycle || (deal.discount >= minDiscount && (deal.listing.sales7d ?? 0) >= minSales7d)),
    )
    .sort((a, b) => b.discount - a.discount)
    .slice(0, maxChecks);

  const deals: Deal[] = [];
  let errors = 0;
  for (const [index, quickDeal] of quick.entries()) {
    const listing = quickDeal.listing;
    try {
      const competition = await fetchCompetition(api, listing.characterId, listing.id);
      const deal = dealFor(listing, competition.lowestAsk, recycle, rules);
      const liquid = (listing.sales7d ?? 0) >= minSales7d;
      if (deal.belowRecycle || (deal.discount >= minDiscount && liquid && deal.profit >= minProfit)) {
        deals.push(deal);
      }
    } catch {
      errors += 1;
    }
    if (index < quick.length - 1) await wait(MARKET_PAGE_DELAY_MS);
  }

  return {
    deals: deals.sort((a, b) => b.profit - a.profit),
    scanned: market.listings.length,
    pages: market.pages,
    checks: quick.length,
    errors,
  };
}
