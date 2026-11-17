import type { CardsExtra } from './cards';

/** Préfixes réservés aux éléments injectés par l'extension. */
export const WISH_TILE_CLASS = 'kyaraext-wish-tile';
export const WISH_BADGE_CLASS = 'kyaraext-wish-tile-badge';

const CARD_ID_RE = /\/cards\/[a-z0-9_-]+\/(\d+)\./i;
const TRADE_TITLE_RE = /^(?:Échange avec|Proposer un échange (?:à|avec))\s+(.+)$/i;

export function cardIdFromImage(src: string | null | undefined): number | null {
  const match = (src ?? '').match(CARD_ID_RE);
  if (!match?.[1]) return null;
  const id = Number(match[1]);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export interface TradeModal {
  heading: Element;
  root: Element;
  name: string;
}

/** Repère l'ancienne fenêtre « Échange avec X » et la nouvelle « Proposer un échange à X ». */
export function findTradeModal(doc: Document): TradeModal | null {
  for (const heading of doc.querySelectorAll('h1, h2, h3, [class*="title"]')) {
    const match = (heading.textContent ?? '').trim().match(TRADE_TITLE_RE);
    if (!match?.[1]) continue;
    const root =
      heading.closest('[role="dialog"], dialog, [class*="modal"], [class*="Modal"]') ??
      heading.parentElement?.parentElement ??
      doc.body;
    if (!root) continue;
    return { heading, root, name: match[1].trim() };
  }
  return null;
}

/**
 * Dans la nouvelle fenêtre, seules les cartes de l'ami doivent être marquées. S'il n'y a
 * pas d'onglets (ancienne fenêtre), on décore toutes les cartes visibles.
 */
export function isFriendCardsTabActive(root: ParentNode): boolean {
  const tabs = [...root.querySelectorAll('[role="tab"]')];
  if (!tabs.length) return true;
  const friend = tabs.find((tab) => /^Cartes de\b/i.test((tab.textContent ?? '').trim()));
  return friend?.getAttribute('aria-selected') === 'true';
}

export function clearWishlistBadges(root: ParentNode): void {
  for (const tile of root.querySelectorAll(`.${WISH_TILE_CLASS}`)) {
    tile.classList.remove(WISH_TILE_CLASS);
  }
  for (const badge of root.querySelectorAll(`.${WISH_BADGE_CLASS}`)) {
    badge.remove();
  }
}

/** Ajoute ou retire le badge « ★ Envie » sur chaque carte de la fenêtre d'échange. */
export function decorateWishlistBadges(
  root: ParentNode,
  wish: ReadonlySet<number>,
  doc: Document,
): void {
  if (!isFriendCardsTabActive(root)) {
    clearWishlistBadges(root);
    return;
  }
  if (!wish.size) {
    clearWishlistBadges(root);
    return;
  }

  for (const image of root.querySelectorAll('img[src*="/cards/"]')) {
    if (image.closest(`.${WISH_BADGE_CLASS}`)) continue;
    const id = cardIdFromImage(image.getAttribute('src'));
    if (id === null) continue;
    const tile = image.closest('.tile') ?? image.parentElement?.parentElement ?? image.parentElement;
    if (!tile) continue;

    const wanted = wish.has(id);
    const badge = tile.querySelector<HTMLElement>(`:scope > .${WISH_BADGE_CLASS}`);
    if (!wanted) {
      tile.classList.remove(WISH_TILE_CLASS);
      badge?.remove();
      continue;
    }

    tile.classList.add(WISH_TILE_CLASS);
    if (!badge) {
      const next = doc.createElement('span');
      next.className = WISH_BADGE_CLASS;
      next.textContent = '★ Envie';
      next.title = 'Cette carte est dans ta liste d’envies';
      tile.append(next);
    }
  }
}

export interface WishlistBadgesOptions {
  document: Document;
  loadWishlist: () => Promise<readonly number[]>;
  /** Horloge injectable pour les tests. */
  now?: () => number;
  /** Délai entre deux relectures de la liste, en ms. */
  refreshMs?: number;
}

/**
 * Module branché sur le contrôleur de cartes : charge la wishlist à la première fenêtre
 * d'échange, puis décore les cartes. Une erreur de lecture laisse simplement les badges
 * absents et sera retentée plus tard.
 */
export function createWishlistBadges(options: WishlistBadgesOptions): CardsExtra {
  const doc = options.document;
  const now = options.now ?? Date.now;
  const refreshMs = options.refreshMs ?? 30_000;
  let wish: Set<number> | null = null;
  let loading = false;
  let nextTry = 0;
  let destroyed = false;

  function refresh(): void {
    if (destroyed || loading) return;
    const at = now();
    if (at < nextTry) return;
    nextTry = at + refreshMs;
    loading = true;
    void Promise.resolve()
      .then(options.loadWishlist)
      .then((ids) => {
        if (!destroyed) wish = new Set(ids);
      })
      .catch(() => {
        // Pas de session ou réseau indisponible : on garde la liste précédente.
      })
      .finally(() => {
        loading = false;
        if (!destroyed) scan();
      });
  }

  function scan(): void {
    if (destroyed) return;
    const modal = findTradeModal(doc);
    if (!modal) return;
    if (!wish) {
      refresh();
      return;
    }
    decorateWishlistBadges(modal.root, wish, doc);
    refresh();
  }

  return {
    scan,
    destroy(): void {
      destroyed = true;
      clearWishlistBadges(doc);
    },
  };
}
