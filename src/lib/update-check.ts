import { storage } from 'wxt/utils/storage';

/**
 * Vérification de mise à jour : `runtime.requestUpdateCheck` (Chrome) quand il existe,
 * résultat gardé six heures. Aucune requête réseau maison, donc aucune permission en plus.
 * Sous Firefox, les mises à jour de la fiche AMO sont prises en charge par le navigateur.
 */

export const REPO_URL = 'https://github.com/Maxray0/Kyara-Plus';

/** Fiche AMO publiée : les mises à jour Firefox sont ensuite gérées par le navigateur. */
export const AMO_URL = 'https://addons.mozilla.org/fr/firefox/addon/kyara-plus/';
export const CHROME_STORE_URL = '';

export const UPDATE_CHECK_TTL_MS = 6 * 60 * 60 * 1000;

export interface StoreLink {
  label: string;
  href: string;
}

export function storeLinks(): StoreLink[] {
  const links: StoreLink[] = [{ label: 'Code source (GitHub)', href: REPO_URL }];
  if (AMO_URL) links.push({ label: 'Fiche Firefox (AMO)', href: AMO_URL });
  if (CHROME_STORE_URL) links.push({ label: 'Fiche Chrome Web Store', href: CHROME_STORE_URL });
  return links;
}

export type UpdateStatus = 'update' | 'none' | 'unknown';

export interface UpdateCheck {
  status: UpdateStatus;
  /** Version annoncée par le navigateur, quand il la donne. */
  version: string | null;
  /** Date du dernier relevé, `null` si aucun n'a abouti. */
  at: number | null;
}

export const EMPTY_UPDATE: UpdateCheck = { status: 'unknown', version: null, at: null };

export const updateItem = storage.defineItem<UpdateCheck>('local:updateCheck', {
  fallback: EMPTY_UPDATE,
  version: 1,
});

interface UpdateRuntime {
  requestUpdateCheck?: () => Promise<{ status?: string; details?: { version?: string } }>;
}

export function normalizeUpdate(raw: unknown): UpdateCheck {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_UPDATE };
  const value = raw as Record<string, unknown>;
  const status =
    value.status === 'update' || value.status === 'none' || value.status === 'unknown'
      ? value.status
      : 'unknown';
  const version = typeof value.version === 'string' && value.version.trim() ? value.version : null;
  const at = typeof value.at === 'number' && Number.isFinite(value.at) && value.at > 0 ? value.at : null;
  return { status, version, at };
}

/** Un relevé de moins de six heures est réutilisé tel quel. */
export function isFresh(check: UpdateCheck, now: number): boolean {
  return check.at !== null && now - check.at >= 0 && now - check.at < UPDATE_CHECK_TTL_MS;
}

export function updateLabel(check: UpdateCheck): string {
  if (check.status === 'update') {
    return check.version ? `Mise à jour ${check.version} disponible` : 'Mise à jour disponible';
  }
  if (check.status === 'none') return 'À jour';
  return 'Mise à jour : vérification indisponible ici';
}

/**
 * Interroge le navigateur si possible. `unknown` reste honnête : en développement ou dans
 * un navigateur sans `requestUpdateCheck`, rien ne permet de conclure.
 */
export async function checkUpdate(
  runtime: UpdateRuntime | undefined,
  now = Date.now(),
): Promise<UpdateCheck> {
  if (!runtime || typeof runtime.requestUpdateCheck !== 'function') {
    return { status: 'unknown', version: null, at: null };
  }
  try {
    const result = await runtime.requestUpdateCheck();
    if (result?.status === 'update_available') {
      const version = result.details?.version;
      return {
        status: 'update',
        version: typeof version === 'string' && version.trim() ? version : null,
        at: now,
      };
    }
    if (result?.status === 'no_update') return { status: 'none', version: null, at: now };
    return { status: 'unknown', version: null, at: now };
  } catch {
    return { status: 'unknown', version: null, at: now };
  }
}

/** Relève au plus toutes les six heures ; un stockage en échec reste sans conséquence. */
export async function loadUpdateCheck(
  runtime: UpdateRuntime | undefined,
  now = Date.now(),
): Promise<UpdateCheck> {
  let cached = { ...EMPTY_UPDATE };
  try {
    cached = normalizeUpdate(await updateItem.getValue());
  } catch {
    /* stockage illisible : la valeur vide suffit */
  }
  if (isFresh(cached, now)) return cached;
  const next = await checkUpdate(runtime, now);
  if (next.status === 'unknown') return cached.at === null ? next : { ...cached, status: 'unknown' };
  try {
    await updateItem.setValue(next);
  } catch {
    /* stockage indisponible : le relevé reste affiché pour cette ouverture */
  }
  return next;
}
