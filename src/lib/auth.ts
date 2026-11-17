import { storage } from 'wxt/utils/storage';

export interface Session {
  token: string;
  deviceId: string | null;
  capturedAt: number;
}

/** Jeton gardé en mémoire de session du navigateur : jamais écrit sur disque. */
export const sessionItem = storage.defineItem<Session | null>('session:auth', { fallback: null });

/** Vrai quand le site a refusé le jeton (401) ; levé à la prochaine session valide. */
export const authExpiredItem = storage.defineItem<boolean>('session:authExpired', {
  fallback: false,
});

/**
 * Lit la session dans le stockage de la page. Le laissez-passer anti-robot
 * (`kyara_pass`) n'est volontairement jamais lu.
 */
export function readPageSession(
  pageStorage: Pick<Storage, 'getItem'>,
  now: () => number = Date.now,
): Session | null {
  const token = pageStorage.getItem('kyara_token');
  if (!token) return null;
  return { token, deviceId: pageStorage.getItem('kyara_device'), capturedAt: now() };
}

/**
 * En-têtes d'authentification identiques à ceux du site : jeton et identifiant d'appareil.
 * Jamais `x-pass`. Vide quand l'utilisateur n'est pas connecté.
 */
export function authHeaders(session: Session | null): Record<string, string> {
  if (!session) return {};
  const headers: Record<string, string> = { authorization: `Bearer ${session.token}` };
  if (session.deviceId && /^[\w-]{8,64}$/.test(session.deviceId)) {
    headers['x-device-id'] = session.deviceId;
  }
  return headers;
}

export async function saveSession(session: Session): Promise<void> {
  await sessionItem.setValue(session);
  await authExpiredItem.setValue(false);
}

export async function markSessionExpired(): Promise<void> {
  await sessionItem.setValue(null);
  await authExpiredItem.setValue(true);
}
