/**
 * Petit bus de données : une écriture de jeu rend les caches locaux faux. Les modules
 * qui écrivent le signalent, et ceux qui affichent peuvent réagir sans relire le réseau.
 */

export interface DataChange {
  /** La liste d'envies a changé (ajout ou retrait). */
  wishlist?: boolean;
  /** La collection a changé (vente, recyclage, échange, épingle). */
  owned?: boolean;
  /** D'où vient le changement, pour le journal et les tests. */
  reason: string;
}

type Listener = (change: DataChange) => void;

const listeners = new Set<Listener>();

/** Abonne un auditeur ; le retour le retire. */
export function onDataChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Prévient les auditeurs sans jamais laisser une exception casser l'écriture. */
export function emitDataChange(change: DataChange): void {
  for (const listener of [...listeners]) {
    try {
      listener(change);
    } catch {
      // Un auditeur fautif ne doit pas bloquer l'écriture qui l'a prévenu.
    }
  }
}
