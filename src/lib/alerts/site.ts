import bellCss from './bell.css?inline';
import { createAlertBell } from './bell';

/** Identifiant de l'hôte injecté dans le header du site. */
export const SITE_ALERT_HOST_ID = 'kyara-plus-alerts';

export interface SiteAlertBellOptions {
  document?: Document;
  /** Cloche déjà créée, utile pour les tests et le harnais visuel. */
  bell?: ReturnType<typeof createAlertBell>;
}

export interface SiteAlertBellController {
  host: HTMLElement;
  bell: ReturnType<typeof createAlertBell>;
  /** Réinsère l'hôte dans le header du site ; true si le header a été trouvé. */
  place: () => boolean;
  destroy: () => void;
}

/**
 * Monte la cloche locale dans le header de kyara.games, entre le bouton des missions et
 * la cloche native. Le shadow DOM protège ses styles du thème du site ; le
 * MutationObserver la replace si Svelte remplace ou réordonne le header.
 */
export function mountSiteAlertBell(options: SiteAlertBellOptions = {}): SiteAlertBellController {
  const doc = options.document ?? document;
  const host = doc.createElement('div');
  host.id = SITE_ALERT_HOST_ID;
  host.dataset.kyaraPlusAlerts = '1';
  // Les marges écartent la cloche locale du bouton des missions et de la cloche du site.
  host.style.cssText =
    'display:flex;align-items:center;position:relative;z-index:5;flex:none;margin:0 8px;';

  const shadow = host.attachShadow({ mode: 'open' });
  const style = doc.createElement('style');
  style.textContent = bellCss;
  shadow.append(style);

  const bell = options.bell ?? createAlertBell();
  shadow.append(bell.element);

  function moveBefore(reference: HTMLElement): void {
    const parent = reference.parentElement;
    if (!parent) return;
    if (host.parentElement !== parent || host.nextElementSibling !== reference) {
      parent.insertBefore(host, reference);
    }
  }

  function place(): boolean {
    const side = doc.querySelector<HTMLElement>('.hdr .side, header .side');
    if (!side) return false;
    // La cloche locale doit rester juste après le bouton des missions. Le site peut
    // placer ce bouton directement dans `.side` ou dans le wrapper de sa cloche : on
    // s'insère donc après lui dans son propre parent, jamais seulement avant `.wrapper`.
    const missions = side.querySelector<HTMLElement>('.mis.icon-btn');
    if (missions?.parentElement) {
      if (host.previousElementSibling !== missions) missions.after(host);
      return true;
    }
    // Sans missions, on se place avant la cloche native, wrapper compris.
    const siteBell = side.querySelector<HTMLElement>('.bell');
    const native = siteBell?.closest<HTMLElement>('.wrapper') ?? siteBell;
    if (native) {
      moveBefore(native);
      return true;
    }
    const wallet = [...side.children].find((child) => child.classList.contains('wallet-w'));
    if (wallet) wallet.after(host);
    else if (host.parentElement !== side) side.append(host);
    return true;
  }

  let retry: ReturnType<typeof setTimeout> | undefined;
  const observer = new MutationObserver(() => {
    // Même connectée, la cloche peut avoir été déplacée avant les missions par un
    // rendu Svelte : on replace toujours, l'insertion étant sans effet si l'ordre est bon.
    clearTimeout(retry);
    retry = setTimeout(place, 100);
  });
  observer.observe(doc.documentElement, { childList: true, subtree: true });
  place();

  return {
    host,
    bell,
    place,
    destroy(): void {
      observer.disconnect();
      clearTimeout(retry);
      bell.destroy();
      host.remove();
    },
  };
}
