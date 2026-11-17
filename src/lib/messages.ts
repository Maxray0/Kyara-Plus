import type { Session } from './auth';

const EXTENSION_PAGES = {
  popup: '/popup.html#reglages',
  doublons: '/doublons.html',
  trades: '/doublons.html#trades',
  wishes: '/doublons.html#wishes',
  stats: '/stats.html',
} as const;

export type ExtensionPage = keyof typeof EXTENSION_PAGES;

/** Messages envoyés par les content scripts vers le fond. */
export type Message =
  | { type: 'auth:update'; session: Session }
  | { type: 'auth:expired' }
  | { type: 'ui:open'; page: ExtensionPage };

/** Page d'extension demandée par le panneau : jamais un chemin libre. */
export function isExtensionPage(value: unknown): value is ExtensionPage {
  return typeof value === 'string' && Object.hasOwn(EXTENSION_PAGES, value);
}

export function extensionPagePath(page: ExtensionPage): (typeof EXTENSION_PAGES)[ExtensionPage] {
  return EXTENSION_PAGES[page];
}

/** Demandes des pages d'extension au content script d'un onglet Kyara. */
export type ContentRequest =
  | { type: 'packs:refresh' }
  | {
      type: 'api:request';
      path: string;
      method?: 'GET' | 'POST' | 'PUT';
      body?: unknown;
      timeoutMs?: number;
    };

/** Réponse du relais : l'erreur est sérialisée pour être reconstruite côté page d'extension. */
export type RelayResponse =
  | { ok: true; data: unknown }
  | { ok: false; status: number; code: string | null; message: string; data?: unknown };

/**
 * Écritures que le relais accepte, et rien d'autre : mettre en vente, annuler une annonce,
 * recycler, verrouiller une carte, ajouter une envie, accepter un échange. Toute autre
 * écriture sur l'API du site est refusée.
 */
const WRITABLE: { method: 'POST' | 'PUT'; pattern: RegExp }[] = [
  { method: 'POST', pattern: /^\/api\/market\/listings$/ },
  { method: 'POST', pattern: /^\/api\/market\/listings\/[\w-]{1,64}\/cancel$/ },
  { method: 'POST', pattern: /^\/api\/me\/collection\/\d{1,10}\/recycle$/ },
  { method: 'POST', pattern: /^\/api\/me\/collection\/\d{1,10}\/pin$/ },
  { method: 'POST', pattern: /^\/api\/trades\/offers\/[\w-]{1,64}\/accept$/ },
  { method: 'PUT', pattern: /^\/api\/me\/wishlist\/\d{1,10}$/ },
];

/** Écritures autorisées au relais : méthode et chemin doivent correspondre ensemble. */
export function isRelayWritable(path: string, method: 'POST' | 'PUT' = 'POST'): boolean {
  return WRITABLE.some((entry) => entry.method === method && entry.pattern.test(path));
}

export function isContentRequest(value: unknown): value is ContentRequest {
  if (!value || typeof value !== 'object') return false;
  const request = value as { type?: unknown; path?: unknown; method?: unknown };
  if (request.type === 'packs:refresh') return true;
  if (request.type !== 'api:request') return false;
  if (typeof request.path !== 'string' || !request.path.startsWith('/api/')) return false;
  if (request.method === undefined || request.method === 'GET') return true;
  if (request.method !== 'POST' && request.method !== 'PUT') return false;
  return isRelayWritable(request.path, request.method);
}

export function isMessage(value: unknown): value is Message {
  if (!value || typeof value !== 'object') return false;
  const message = value as { type?: unknown; session?: unknown; page?: unknown };
  if (message.type === 'auth:expired') return true;
  if (message.type === 'ui:open') return isExtensionPage(message.page);
  if (message.type !== 'auth:update') return false;
  const session = message.session as Partial<Session> | null | undefined;
  return typeof session?.token === 'string' && session.token.length > 0;
}
