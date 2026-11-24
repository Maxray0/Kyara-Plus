import { AuthError } from '../api';
import { applyPrice, type Candidate } from './candidates';
import {
  FAIR_MAX_RATIO,
  call,
  cancelListing,
  fetchFairPrices,
  fetchPrices,
  getMarket,
  hasShapeChanges,
  shapeChangesItem,
  type Api,
  type Listing,
} from './market';
import { invalidateOwnedCache } from './owned-cache';
import { boundsFromError, clampPrice, computePrice } from './pricing';
import type { SellSettings } from './settings';

export type LogKind = 'info' | 'warn' | 'sale';

export interface SellOptions {
  log?: (message: string, kind?: LogKind) => void;
  onUpdate?: () => void;
  sleep?: (ms: number) => Promise<void>;
  /** Écart entre deux annonces. */
  gapMs?: number;
  /** Motif de l'invalidation de possession, visible dans le bus de données. */
  reason?: string;
  /**
   * Annonces actives comptées par carte, lues juste avant la passe. Fournie, elle active la
   * garde : `sellNext` ne crée jamais plus d'annonces dans la passe que d'exemplaires libres
   * (`sellable`, déjà net des copies en ligne lues par `buildCandidates`).
   */
  listed?: ReadonlyMap<number, number>;
  /** Origine des annonces, visible dans le journal (vente automatique, panneau…). */
  source?: string;
}

/** Exemplaires déjà en vente par carte, pour la garde anti-doublon de `sellNext`. */
export function listedCounts(
  listings: readonly { characterId: number; qty?: number }[],
): Map<number, number> {
  const counts = new Map<number, number>();
  for (const listing of listings) {
    const qty = Math.max(1, Math.trunc(Number(listing.qty ?? 1)) || 1);
    counts.set(listing.characterId, (counts.get(listing.characterId) ?? 0) + qty);
  }
  return counts;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const nameOf = (c: Candidate) => c.name || `Perso #${c.id}`;

/** Cartes sélectionnées à envoyer dans les emplacements libres, dans l'ordre de la liste. */
export function fillSelection(list: readonly Candidate[], free: number): Candidate[] {
  const limit = Math.max(0, Math.floor(free));
  if (!limit) return [];
  return list
    .filter((c) => c.checked === true && !c.blocked && c.sellable > 0)
    .slice(0, limit);
}

/** Carte synthétique pour remettre une annonce active en vente à un prix choisi. */
export function candidateFromListing(listing: Listing, price: number): Candidate {
  return {
    id: listing.characterId,
    qty: 1,
    locked: 0,
    sellable: 1,
    firstAt: listing.createdAt,
    blocked: null,
    status: '',
    prices: null,
    pricedAt: null,
    price,
    priceWhy: '',
    manual: true,
    name: listing.name,
    image: listing.image,
    rarity: listing.rarity,
    series: null,
    checked: false,
  };
}

/**
 * Met en vente, dans l'ordre, jusqu'à `free` annonces : pour chaque carte, prix frais puis
 * annonce. S'arrête sur trois refus de suite, une limite de Kyara ou un changement de format.
 * Retourne le nombre d'annonces créées.
 */
export async function sellNext(
  api: Api,
  s: SellSettings,
  todo: Candidate[],
  free: number,
  options: SellOptions = {},
): Promise<number> {
  const log = options.log ?? (() => {});
  const update = options.onUpdate ?? (() => {});
  const sleep = options.sleep ?? defaultSleep;
  const gap = options.gapMs ?? 1200;
  let placed = 0;
  let fails = 0;
  // Sans inventaire d'annonces, la garde ne peut pas savoir ce qui est déjà en ligne : elle ne
  // s'applique qu'aux appelants qui viennent de lire le marché.
  const guardListings = options.listed !== undefined;
  // Seules les annonces ouvertes *dans cette passe* comptent : les copies déjà en ligne sont
  // déjà retirées de `sellable`, les compter ici les soustrairait une seconde fois.
  const onSale = new Map<number, number>();
  // Toute ligne du journal dit d'où vient l'annonce : vente automatique, panneau, page…
  const origin = options.source ? ` · ${options.source}` : '';

  // Un changement de format ne se répare qu'en redemandant un prix : petit essai avant de décider.
  const flags = await shapeChangesItem.getValue();
  if (todo[0] && (flags.prices || flags.fair)) {
    try {
      if (flags.prices) await fetchPrices(api, todo[0].id);
      if (flags.fair) await fetchFairPrices(api, [todo[0].id], { fresh: true });
    } catch (error) {
      if (error instanceof AuthError) throw error;
    }
  }
  if (await hasShapeChanges()) {
    log(
      "Ventes en pause : Kyara a changé quelque chose, l'extension attend une mise à jour.",
      'warn',
    );
    return 0;
  }

  let fair: Map<number, number> | null = null;
  try {
    fair = await fetchFairPrices(
      api,
      todo.slice(0, free * 3).map((c) => c.id),
    );
  } catch (error) {
    if (error instanceof AuthError) throw error;
  }

  for (const c of todo) {
    if (placed >= free) break;
    // Une carte ne reçoit jamais plus d'annonces actives que d'exemplaires vendables : sinon
    // une liste périmée mettrait aussi la copie gardée en vente.
    const already = onSale.get(c.id) ?? 0;
    if (guardListings && already >= c.sellable) {
      c.status = '⏸ déjà en vente';
      c.blocked = 'Déjà en vente';
      c.checked = false;
      log(
        `${nameOf(c)} : annonce bloquée, ${already} exemplaire(s) mis en vente dans cette passe ` +
          `pour ${c.sellable} vendable(s)` +
          (c.locked > 0 ? ` (${c.locked} verrouillé(s) par Kyara)` : '') +
          `${origin}.`,
        'warn',
      );
      update();
      continue;
    }
    c.status = '⏳';
    update();

    if (!c.manual) {
      try {
        c.prices = await fetchPrices(api, c.id);
        c.pricedAt = Date.now();
      } catch (error) {
        if (error instanceof AuthError) throw error;
        c.status = '❌ Prix indisponible';
        update();
        continue;
      }
      applyPrice(c, s);
      if (!c.price) {
        c.blocked = c.priceWhy;
        c.checked = false;
        c.status = '';
        update();
        continue;
      }
    }
    if (!c.price) continue;

    // Kyara refuse plus de ~3 fois le prix habituel : on se cale dessous avant d'envoyer.
    const usual = fair?.get(c.id);
    if (usual && usual > 0 && c.price > Math.floor(usual * FAIR_MAX_RATIO)) {
      const cap = Math.floor(usual * FAIR_MAX_RATIO);
      log(`${nameOf(c)} : ${c.price} ◆ dépasse le maximum de Kyara, mis à ${cap} ◆`, 'info');
      c.price = cap;
    }

    const post = () =>
      call(api, '/api/market/listings', {
        method: 'POST',
        body: {
          characterId: c.id,
          type: 'fixed',
          price: c.price,
          buyoutPrice: null,
          durationHours: s.durationHours,
        },
      });
    let result = await post();

    // Prix hors des bornes du marché : on se cale sur la borne indiquée par Kyara, une seule fois.
    if (!result.ok && result.status === 400) {
      const bounds = boundsFromError(result.data, result.message);
      let fixed = clampPrice(c.price, bounds);
      // Un refus explicite (« price_too_high » / « price_too_low ») rend la borne fiable ; sinon,
      // une borne mal lue ne doit jamais brader la carte ni la surévaluer.
      const trusted = /^price_too_(high|low)$/.test(String(result.code ?? ''));
      const base = computePrice(c.prices, s).base;
      if (!trusted && (!base || fixed < base * 0.5 || fixed > base * 3)) fixed = c.price;
      log(
        `Kyara a refusé ${c.price} ◆ pour ${nameOf(c)} : ${result.message}${
          fixed !== c.price ? ` → nouvel essai à ${fixed} ◆` : ''
        }`,
        'warn',
      );
      if (fixed !== c.price && fixed > 0) {
        c.price = fixed;
        await sleep(800);
        result = await post();
      }
    }

    if (result.ok) {
      placed += 1;
      fails = 0;
      onSale.set(c.id, (onSale.get(c.id) ?? 0) + 1);
      c.status = '✅ en vente';
      c.blocked = 'mis en vente';
      c.checked = false;
      log(
        `${nameOf(c)} mis en vente à ${c.price} chakra` +
          (guardListings ? ` (${already + 1}/${c.sellable} exemplaire(s) en ligne)` : '') +
          origin,
        'sale',
      );
    } else {
      c.status = `❌ ${result.message}`;
      update();
      if (
        result.status === 429 ||
        /limit|limite|max|emplacement|slot|annonces?/i.test(result.message)
      ) {
        log(`Kyara a refusé une annonce : ${result.message}`, 'warn');
        break;
      }
      log(`${nameOf(c)} n'a pas pu être mis en vente : ${result.message}`, 'warn');
      fails += 1;
      if (fails >= 3) {
        log('Trois refus de suite : mise en vente arrêtée par sécurité.', 'warn');
        break;
      }
    }
    update();
    await sleep(gap);
  }
  // Une carte vendue n'est plus disponible : la possession mémorisée est périmée ici, pas
  // chez l'appelant, pour couvrir le panneau, la page Doublons et la vente automatique.
  if (placed > 0) await invalidateOwnedCache(options.reason ?? 'vente');
  return placed;
}

export interface RepriceResult {
  /** L'ancienne annonce a bien été retirée. */
  cancelled: boolean;
  /** La nouvelle annonce a bien été créée. */
  listed: boolean;
  /** Prix réellement envoyé (peut avoir été plafonné par Kyara). */
  price: number | null;
  message: string;
}

/**
 * Ajuste le prix d'une annonce active : Kyara n'expose pas de route de modification,
 * on retire l'annonce puis on la remet en vente avec le prix choisi.
 */
export async function repriceListing(
  api: Api,
  listing: Listing,
  target: number,
  s: SellSettings,
  options: SellOptions = {},
): Promise<RepriceResult> {
  const price = Math.round(Number(target));
  if (!Number.isSafeInteger(price) || price < 1) {
    return { cancelled: false, listed: false, price: null, message: 'Prix invalide' };
  }
  if (listing.type === 'auction') {
    return {
      cancelled: false,
      listed: false,
      price: null,
      message: 'Une enchère ne peut pas être ajustée',
    };
  }

  const cancellation = await cancelListing(api, listing.id);
  if (!cancellation.ok) {
    return {
      cancelled: false,
      listed: false,
      price: null,
      message: cancellation.message || 'annulation refusée',
    };
  }

  const card = candidateFromListing(listing, price);
  await (options.sleep ?? defaultSleep)(800);
  let placed = 0;
  let message = '';
  try {
    placed = await sellNext(api, s, [card], 1, {
      ...options,
      gapMs: options.gapMs ?? 0,
      source: options.source ?? 'ajustement',
    });
  } catch (error) {
    // L'ancienne annonce est déjà retirée : on remonte l'échec sans perdre cette information.
    message = error instanceof Error ? error.message : 'erreur inconnue';
  }

  return {
    cancelled: true,
    listed: placed === 1,
    price: card.price ?? price,
    message: placed === 1 ? '' : message || card.status || card.priceWhy || 'refus de Kyara',
  };
}

/** Emplacements libres : annonces actives déduites du maximum choisi. */
export async function freeSlots(api: Api, s: SellSettings) {
  const { active, holds } = await getMarket(api);
  return { active, holds, free: Math.max(0, s.maxSlots - active.length) };
}
