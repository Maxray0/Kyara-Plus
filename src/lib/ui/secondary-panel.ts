/**
 * Panneau secondaire unique : « Mes doublons » et « Chercher dans le marché » se
 * remplacent l'un l'autre au lieu de s'empiler. Chaque panneau s'enregistre avec sa
 * fonction de fermeture et demande la fermeture des autres avant de s'afficher.
 */

type Closer = () => void;

const panels = new Map<string, Closer>();

export function registerSecondaryPanel(id: string, close: Closer): void {
  panels.set(id, close);
}

export function unregisterSecondaryPanel(id: string, close: Closer): void {
  if (panels.get(id) === close) panels.delete(id);
}

/** Ferme tous les panneaux secondaires sauf `except`. */
export function closeOtherSecondaryPanels(except: string): void {
  for (const [id, close] of [...panels]) {
    if (id === except) continue;
    panels.delete(id);
    close();
  }
}

export function openSecondaryPanels(): string[] {
  return [...panels.keys()];
}
