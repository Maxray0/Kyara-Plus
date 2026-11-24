import { storage } from 'wxt/utils/storage';

/**
 * Sauvegarde et restauration locales : réglages et caches de travail dans un JSON lisible.
 * Aucun secret, aucune donnée de session ; la restauration ne peut écrire que les clés
 * connues, jamais une clé arbitraire lue dans le fichier.
 */

export const BACKUP_VERSION = 1;

/** Clés locales sauvegardées, dans l'ordre de lecture. */
export const BACKUP_KEYS = [
  'settings',
  'sellSettings',
  'tradeSettings',
  'buyPlan',
  'buyOrders',
  'orderQueue',
  'buyAutoSettings',
  'marketWatch',
  'repriceSettings',
  'wishlist',
  'sellPrices',
] as const;

export type BackupKey = (typeof BACKUP_KEYS)[number];

export interface Backup {
  version: number;
  at: number;
  data: Partial<Record<BackupKey, unknown>>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** Ne garde que les clés connues et définies. */
export function buildBackup(raw: Record<string, unknown>, now = Date.now()): Backup {
  const data: Partial<Record<BackupKey, unknown>> = {};
  for (const key of BACKUP_KEYS) {
    if (raw[key] !== undefined) data[key] = raw[key];
  }
  return { version: BACKUP_VERSION, at: now, data };
}

export type ParseResult = { ok: true; backup: Backup } | { ok: false; error: string };

export function parseBackup(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'Fichier JSON illisible.' };
  }
  if (!isRecord(raw)) return { ok: false, error: 'Format de sauvegarde inattendu.' };
  const version = Number(raw.version);
  if (!Number.isSafeInteger(version) || version < 1 || version > BACKUP_VERSION) {
    return { ok: false, error: 'Version de sauvegarde non reconnue.' };
  }
  if (!isRecord(raw.data)) return { ok: false, error: 'Sauvegarde vide ou sans données.' };
  const at = Number(raw.at);
  const data: Partial<Record<BackupKey, unknown>> = {};
  for (const key of BACKUP_KEYS) {
    if (raw.data[key] !== undefined) data[key] = raw.data[key];
  }
  if (!Object.keys(data).length) return { ok: false, error: 'Aucune clé connue dans la sauvegarde.' };
  return {
    ok: true,
    backup: { version: BACKUP_VERSION, at: Number.isFinite(at) && at > 0 ? at : 0, data },
  };
}

export function backupSummary(backup: Backup): string {
  const keys = Object.keys(backup.data) as BackupKey[];
  const when = backup.at ? new Date(backup.at).toLocaleString('fr-FR') : 'date inconnue';
  return `${keys.length} réglage(s) sauvegardé(s) · ${when}`;
}

export function backupJson(backup: Backup): string {
  return JSON.stringify(backup, null, 2);
}

/**
 * Caches de travail effaçables sans toucher aux réglages, aux journaux ni aux ventes.
 * Le catalogue et les prix se relisent tout seuls ; la duplication et les opportunités
 * se recalculent. `kyara-plus:prices:v1` vit hors du préfixe `local:` (cache Better Kyara).
 */
export const CACHE_KEYS = [
  'catalog',
  'sellPrices',
  'wish-owned',
  'wishlist',
  'duplicateScan',
  'opportunities',
  'duplicateScanAt',
] as const;

/** Clés hors préfixe local, effacées avec les mêmes précautions. */
export const RAW_CACHE_KEYS = ['kyara-plus:prices:v1'] as const;

/** Efface les caches de travail ; renvoie le nombre de clés réellement retirées. */
export async function clearCaches(): Promise<number> {
  let removed = 0;
  for (const key of CACHE_KEYS) {
    const path = `local:${key}` as const;
    const present = await storage.getItem(path).catch(() => null);
    if (present === null || present === undefined) continue;
    await storage.removeItem(path).catch(() => undefined);
    removed += 1;
  }
  for (const key of RAW_CACHE_KEYS) {
    const present = await storage.getItem(key as never).catch(() => null);
    if (present === null || present === undefined) continue;
    await storage.removeItem(key as never).catch(() => undefined);
    removed += 1;
  }
  return removed;
}

/** Lit les clés connues du stockage local. */
export async function exportBackup(now = Date.now()): Promise<Backup> {
  const raw = await storage.getItems(BACKUP_KEYS.map((key) => `local:${key}` as const));
  const values: Record<string, unknown> = {};
  for (const entry of raw) {
    const key = entry.key.replace(/^local:/, '');
    values[key] = entry.value;
  }
  return buildBackup(values, now);
}

/** Écrit uniquement les clés connues ; renvoie celles réellement restaurées. */
export async function restoreBackup(backup: Backup): Promise<BackupKey[]> {
  const written: BackupKey[] = [];
  for (const key of BACKUP_KEYS) {
    if (backup.data[key] === undefined) continue;
    await storage.setItem(`local:${key}` as const, backup.data[key]);
    written.push(key);
  }
  return written;
}
