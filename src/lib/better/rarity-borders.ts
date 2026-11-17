/** Couleur de rareté lue dans le box-shadow posé par le site, pour être juste à chaque rareté. */
export function colorFromShadow(shadow: string | null | undefined): string | null {
  if (!shadow) return null;
  const match = shadow.match(/rgba?\([^)]*\)/);
  return match ? match[0] : null;
}

/**
 * Donne la couleur de rareté (--kl-rar) à chaque carte possédée de la collection et à la carte
 * donnée dans un échange.
 */
export function applyBorders(scope: ParentNode): void {
  scope.querySelectorAll<HTMLElement>('.wrap.body .grid .cell').forEach((cell) => {
    const owned = cell.querySelector('.have');
    if (!owned) {
      cell.style.removeProperty('--kl-rar');
      return;
    }
    const img = owned.querySelector('img') ?? cell.querySelector('img');
    const color = colorFromShadow(img?.style.boxShadow);
    if (color) cell.style.setProperty('--kl-rar', color);
    else cell.style.removeProperty('--kl-rar');
  });

  scope.querySelectorAll<HTMLElement>('a.kyara-lite-give').forEach((card) => {
    const img = card.querySelector('img');
    const color = colorFromShadow(img?.style.boxShadow);
    if (color) card.style.setProperty('--kl-rar', color);
  });
}

export function startRarityBorders(doc: Document) {
  const view = doc.defaultView as Window & typeof globalThis;
  applyBorders(doc);
  const observer = new view.MutationObserver(() => applyBorders(doc));
  observer.observe(doc.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['class', 'style'],
  });
  return { stop: () => observer.disconnect() };
}
