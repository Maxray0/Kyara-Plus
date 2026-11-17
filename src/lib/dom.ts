export type Child = Node | string | null | false | undefined;
export type Attrs = Record<string, string | boolean | ((event: Event) => void) | undefined>;

/** Construit un élément du DOM sans jamais interpréter de HTML : tout texte passe par textContent. */
export function h(tag: string, attrs: Attrs = {}, ...children: Child[]): HTMLElement {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (typeof value === 'function') element.addEventListener(key.slice(2), value);
    else if (key === 'class') element.className = String(value);
    else element.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    element.append(child);
  }
  return element;
}

export function fill(parent: HTMLElement, ...children: Child[]): void {
  parent.replaceChildren(...children.filter((child): child is Node | string => !!child));
}

export const fmt = (n: number) => n.toLocaleString('fr-FR');

/** Seuls les liens relatifs au site et https sont acceptés pour les images. */
export function imageUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.startsWith('/') && !value.startsWith('//')) return `https://kyara.games${value}`;
  return value.startsWith('https://') ? value : null;
}
