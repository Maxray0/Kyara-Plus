import { cancelListing, recycleCard } from './market';
import { pinCard } from './protection';
import { fillSelection, repriceListing, sellNext } from './sell';
import { acceptTrade } from './trades';
import { addWish, removeWish } from './wishlist';

/**
 * Point d'entrée unique des écritures de jeu, partagé par le panneau injecté et les pages
 * d'extension (Doublons, panneau Mes doublons). Chaque action garde exactement les
 * garde-fous de son module — confirmation à deux vrais clics côté appelant, invalidation
 * des caches de possession et d'envies dans la fonction métier — mais une nouvelle
 * écriture n'a plus qu'un seul endroit à câbler, au lieu de deux qui peuvent diverger.
 *
 * Aucune de ces fonctions n'envoie quoi que ce soit par elle-même : elles ne sont
 * appelées qu'après le geste de l'utilisateur.
 */
export const gameActions = {
  /** Met en vente les cartes sélectionnées dans la limite des emplacements libres. */
  sell: (...args: Parameters<typeof sellNext>) => sellNext(...args),
  /** Choisit les cartes cochées qui tiennent dans les emplacements libres. */
  selection: fillSelection,
  /** Annule puis remet en vente une annonce active au prix choisi. */
  reprice: (...args: Parameters<typeof repriceListing>) => repriceListing(...args),
  /** Annule une annonce active. */
  cancel: (...args: Parameters<typeof cancelListing>) => cancelListing(...args),
  /** Recycle des exemplaires d'une carte. */
  recycle: (...args: Parameters<typeof recycleCard>) => recycleCard(...args),
  /** Pose ou retire l'épingle de protection d'une carte. */
  pin: (...args: Parameters<typeof pinCard>) => pinCard(...args),
  /** Accepte une offre d'échange. */
  acceptTrade: (...args: Parameters<typeof acceptTrade>) => acceptTrade(...args),
  /** Ajoute une carte aux envies. */
  addWish: (...args: Parameters<typeof addWish>) => addWish(...args),
  /** Retire une carte des envies. */
  removeWish: (...args: Parameters<typeof removeWish>) => removeWish(...args),
};

export type GameActions = typeof gameActions;
