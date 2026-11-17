/** Boîte de présence du site : « Tu es toujours là ? ». Libellés repris du legacy (kyareeh). */
const TITLE_RE =
  /(tu\s+es\s+toujours\s+l[àa]|es[-\s]?tu\s+(toujours\s+)?l[àa]|toujours\s+l[àa]\s*\?|still\s+(there|here)\??|are\s+you\s+(still\s+)?(there|here))/i;
const CONTEXT_RE =
  /(toujours\s+l[àa]|still\s+(there|here)|are\s+you\s+(still\s+)?(there|here)|anti[-\s]?afk|inactivit[ée]|absence)/i;
const LABEL_RE =
  /^(oui|yes|okay|ok|je\s+suis\s+(toujours\s+)?l[àa]|toujours\s+l[àa]|pr[ée]sent(e)?|me\s+voil[àa]|i\s*'?\s*m\s+here)(?![a-zà-ÿ])/i;

const CONTAINER_SELECTOR =
  '[role="dialog"], [aria-modal="true"], [class*="modal" i], [class*="dialog" i], [class*="overlay" i], [class*="popup" i], [class*="gate" i]';
const BUTTON_SELECTOR = 'button, [role="button"], input[type="button"], input[type="submit"]';

export const AFK_MIN_DELAY_MS = 2_000;
export const AFK_MAX_DELAY_MS = 60_000;
const RETRY_AFTER_MS = 2 * 60_000;
const SCAN_THROTTLE_MS = 1_000;
const SCAN_INTERVAL_MS = 3_000;

export type Visibility = (element: Element) => boolean;

export const defaultIsVisible: Visibility = (element) => {
  if (!element.isConnected) return false;
  const rect = element.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return false;
  const view = element.ownerDocument.defaultView;
  if (!view) return false;
  const style = view.getComputedStyle(element);
  return (
    style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity || 1) > 0.05
  );
};

function labelOf(button: Element): string {
  const text = (button as HTMLElement).innerText ?? button.textContent ?? '';
  const value = (button as HTMLInputElement).value ?? '';
  return (text || value || button.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
}

function textOf(element: Element): string {
  return String((element as HTMLElement).innerText ?? element.textContent ?? '').slice(0, 600);
}

function isDisabled(button: Element): boolean {
  return (button as HTMLButtonElement).disabled === true;
}

export function findAfkContainer(doc: Document, isVisible: Visibility = defaultIsVisible) {
  for (const node of doc.querySelectorAll(CONTAINER_SELECTOR)) {
    if (!isVisible(node)) continue;
    const text = textOf(node);
    if (!text) continue;
    if (TITLE_RE.test(text) || (CONTEXT_RE.test(text) && text.includes('?'))) return node;
  }
  return null;
}

function confirmIn(container: Element, isVisible: Visibility): Element | null {
  let fallback: Element | null = null;
  for (const button of container.querySelectorAll(BUTTON_SELECTOR)) {
    if (!isVisible(button) || isDisabled(button)) continue;
    if (LABEL_RE.test(labelOf(button))) return button;
    fallback ??= button;
  }
  return fallback;
}

/**
 * Bouton de confirmation de la boîte de présence :
 * 1) boîte repérée par son texte, 2) sinon bouton au bon libellé dont un ancêtre parle de présence.
 */
export function findAfkButton(doc: Document, isVisible: Visibility = defaultIsVisible) {
  const container = findAfkContainer(doc, isVisible);
  if (container) {
    const button = confirmIn(container, isVisible);
    if (button) return button;
  }
  for (const button of doc.querySelectorAll(
    `${BUTTON_SELECTOR}, a[class*="btn"], a[class*="button"]`,
  )) {
    if (!isVisible(button) || isDisabled(button) || !LABEL_RE.test(labelOf(button))) continue;
    let node: Element | null = button;
    for (let depth = 0; depth < 8 && node; depth += 1) {
      node = node.parentElement;
      if (!node) break;
      const text = String((node as HTMLElement).innerText ?? node.textContent ?? '');
      if (text.length > 2000) break;
      if (CONTEXT_RE.test(text)) return button;
    }
  }
  return null;
}

export interface AntiAfkOptions {
  document: Document;
  isVisible?: Visibility;
  random?: () => number;
  /** Reçoit un message lisible à chaque détection ou réponse. */
  onEvent?: (message: string) => void;
}

/** Délai de réponse tiré entre 2 et 60 s. */
export function afkDelayMs(random: () => number): number {
  return Math.round(AFK_MIN_DELAY_MS + random() * (AFK_MAX_DELAY_MS - AFK_MIN_DELAY_MS));
}

export function createAntiAfk(options: AntiAfkOptions) {
  const doc = options.document;
  const isVisible = options.isVisible ?? defaultIsVisible;
  const random = options.random ?? Math.random;
  const emit = options.onEvent ?? (() => {});

  let running = false;
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;
  let scanTimer: ReturnType<typeof setInterval> | null = null;
  let observer: MutationObserver | null = null;
  let lastScan = 0;
  let handled: { element: Element; at: number } | null = null;

  function scan(): void {
    if (!running || pendingTimer) return;
    const now = Date.now();
    if (now - lastScan < SCAN_THROTTLE_MS) return;
    lastScan = now;

    const target = findAfkButton(doc, isVisible);
    if (!target) {
      handled = null;
      return;
    }
    if (handled?.element === target && now - handled.at < RETRY_AFTER_MS) return;

    const delay = afkDelayMs(random);
    handled = { element: target, at: now };
    emit(`Anti-AFK détecté : réponse dans ${Math.round(delay / 1000)} s`);
    pendingTimer = setTimeout(() => respond(target), delay);
  }

  function respond(detected: Element): void {
    pendingTimer = null;
    if (!running) return;
    const element = findAfkButton(doc, isVisible) ?? (detected.isConnected ? detected : null);
    if (!element) {
      emit('Anti-AFK : la boîte a disparu avant la réponse');
      return;
    }
    const label = labelOf(element).slice(0, 24) || 'Je suis là';
    (element as HTMLElement).click();
    emit(`Anti-AFK : « ${label} » cliqué`);

    // Le site peut ignorer un clic : une seule seconde tentative si la boîte est toujours là.
    setTimeout(() => {
      if (!running || !findAfkContainer(doc, isVisible)) return;
      const again = findAfkButton(doc, isVisible);
      if (!again) return;
      const view = doc.defaultView;
      if (view) {
        const init = { bubbles: true, cancelable: true, view, button: 0 };
        for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) {
          again.dispatchEvent(new view.MouseEvent(type, init));
        }
      }
      (again as HTMLElement).click();
      emit('Anti-AFK : toujours affiché, seconde tentative');
    }, 1_500);

    setTimeout(() => {
      handled = null;
      scan();
    }, 4_000);
  }

  return {
    start(): void {
      if (running) return;
      running = true;
      const view = doc.defaultView;
      if (view?.MutationObserver) {
        observer = new view.MutationObserver(() => scan());
        observer.observe(doc.documentElement, { childList: true, subtree: true });
      }
      scanTimer = setInterval(scan, SCAN_INTERVAL_MS);
      scan();
    },
    stop(): void {
      running = false;
      observer?.disconnect();
      observer = null;
      if (scanTimer) clearInterval(scanTimer);
      if (pendingTimer) clearTimeout(pendingTimer);
      scanTimer = null;
      pendingTimer = null;
      handled = null;
    },
    scan,
  };
}
