import { storage } from 'wxt/utils/storage';

export interface Settings {
  /** Ouverture automatique de boosters. Désactivée par défaut. */
  autoOpen: boolean;
  /** Réponse automatique à la boîte « Tu es toujours là ? ». Désactivée par défaut. */
  antiAfk: boolean;
  /** Identifiants des boosters à ouvrir automatiquement. Aucun par défaut. */
  autoOpenPackIds: string[];
  /** Autorise Auto-Open à dépenser du chakra. Interdit par défaut : seuls dons et boosters offerts. */
  autoOpenAllowChakra: boolean;
  /** Mise en vente automatique des doublons selon les réglages de la page Doublons. Désactivée par défaut. */
  autoSell: boolean;
  /** Vide la file d'ordres d'achat de l'extension dès qu'une place se libère. Désactivée par défaut. */
  orderQueueAuto: boolean;
  /** Coupe-circuit : vrai, aucune boucle ne tourne. Se réarme à la main ; déclenché seul après des échecs. */
  killSwitch: boolean;
  /** Attente d'Auto-Open quand aucun booster ne s'ouvre, en secondes (5 à 300). */
  autoOpenIdleSec: number;
}

export const DEFAULT_SETTINGS: Readonly<Settings> = {
  autoOpen: false,
  antiAfk: false,
  autoOpenPackIds: [],
  autoOpenAllowChakra: false,
  autoSell: false,
  orderQueueAuto: false,
  killSwitch: false,
  autoOpenIdleSec: 30,
};

function idleSeconds(value: unknown): number {
  const seconds = typeof value === 'string' ? Number(value) : value;
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return DEFAULT_SETTINGS.autoOpenIdleSec;
  return Math.min(300, Math.max(5, Math.round(seconds)));
}

export const settingsItem = storage.defineItem<Settings>('local:settings', {
  fallback: { ...DEFAULT_SETTINGS },
  version: 1,
});

/** Une option n'est active que si la valeur stockée est exactement `true`. */
export function normalizeSettings(raw: unknown): Settings {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const ids = Array.isArray(source.autoOpenPackIds)
    ? source.autoOpenPackIds.filter((id): id is string => typeof id === 'string' && id !== '')
    : [];
  return {
    autoOpen: source.autoOpen === true,
    antiAfk: source.antiAfk === true,
    autoOpenPackIds: [...new Set(ids)],
    autoOpenAllowChakra: source.autoOpenAllowChakra === true,
    autoSell: source.autoSell === true,
    orderQueueAuto: source.orderQueueAuto === true,
    killSwitch: source.killSwitch === true,
    autoOpenIdleSec: idleSeconds(source.autoOpenIdleSec),
  };
}

export async function getSettings(): Promise<Settings> {
  return normalizeSettings(await settingsItem.getValue());
}

export async function setSetting<K extends keyof Settings>(
  key: K,
  value: Settings[K],
): Promise<Settings> {
  const next = { ...(await getSettings()), [key]: value };
  await settingsItem.setValue(next);
  return next;
}
