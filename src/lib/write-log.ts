import { storage } from 'wxt/utils/storage';

/**
 * Journal local des écritures de jeu : une entrée par requête qui modifie quelque chose
 * chez Kyara (vente, achat, mise, recyclage, protection, échange, envie, ouverture de
 * booster), avec son résultat. Il est rempli par le client API et par le relais, puis lu
 * sans requête supplémentaire par le panneau (Activité → Écritures) et par le pont du
 * conteneur (`GET /writes`). Aucun corps de requête n'est conservé : seulement le
 * libellé, la carte ou l'annonce concernée et le prix quand il est connu.
 */

export interface WriteLogEntry {
  at: number;
  /** Libellé court : « Mise en vente », « Achat au marché »… */
  action: string;
  /** Précision lisible : carte, annonce, prix, quantité. */
  detail: string;
  method: string;
  path: string;
  ok: boolean;
  /** Statut HTTP du refus, `null` quand la requête a réussi ou n'a pas abouti. */
  status: number | null;
  error: string | null;
}

/** Écritures conservées : au-delà, les plus anciennes sortent. */
export const WRITE_LOG_MAX = 200;

export const writeLogItem = storage.defineItem<WriteLogEntry[]>('local:writeLog', {
  fallback: [],
  version: 1,
});

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const text = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : '';

const positiveInt = (value: unknown): number | null => {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) && number > 0 ? Math.trunc(number) : null;
};

/** Valeurs numériques du corps, vides quand le champ manque ou n'est pas un entier. */
const money = (value: unknown): string => {
  const number = positiveInt(value);
  return number === null ? '' : `${number} ◆`;
};
const card = (value: unknown): string => {
  const id = positiveInt(value);
  return id === null ? '' : `carte #${id}`;
};
const times = (value: unknown): string => {
  const count = positiveInt(value);
  return count === null || count < 2 ? '' : `× ${count}`;
};
const limit = (value: unknown): string => {
  const number = positiveInt(value);
  return number === null ? '' : `max ${number} ◆`;
};
const hours = (value: unknown): string => {
  const number = positiveInt(value);
  return number === null ? '' : `${number} h`;
};

const join = (...items: string[]): string => items.filter(Boolean).join(' · ');
const shortId = (id: string): string => id.slice(0, 60);

export interface WriteDescription {
  action: string;
  detail: string;
}

interface WriteRule {
  method: 'POST' | 'PUT' | 'DELETE';
  pattern: RegExp;
  /** `id` est le segment capturé du chemin (carte, annonce, offre). */
  describe: (body: Record<string, unknown>, id: string) => WriteDescription;
}

/**
 * Écritures connues, par méthode et par chemin. Un corps n'est lu que pour des valeurs
 * numériques bornées (carte, prix, quantité) : rien d'autre n'entre dans le journal.
 */
const RULES: readonly WriteRule[] = [
  {
    method: 'POST',
    pattern: /^\/api\/market\/listings$/,
    describe: (body) => ({
      action: 'Mise en vente',
      detail: join(card(body.characterId ?? body.cardId), money(body.price), hours(body.durationHours)),
    }),
  },
  {
    method: 'POST',
    pattern: /^\/api\/market\/listings\/([^/]+)\/cancel$/,
    describe: (_body, id) => ({ action: 'Annonce retirée', detail: `annonce ${shortId(id)}` }),
  },
  {
    method: 'POST',
    pattern: /^\/api\/market\/listings\/([^/]+)\/buy$/,
    describe: (_body, id) => ({ action: 'Achat au marché', detail: `annonce ${shortId(id)}` }),
  },
  {
    method: 'POST',
    pattern: /^\/api\/market\/listings\/([^/]+)\/bid$/,
    describe: (body, id) => ({
      action: 'Mise en enchère',
      detail: join(`annonce ${shortId(id)}`, limit(body.maxAmount)),
    }),
  },
  {
    method: 'POST',
    pattern: /^\/api\/me\/collection\/(\d+)\/recycle$/,
    describe: (body, id) => ({ action: 'Recyclage', detail: join(`carte #${id}`, times(body.qty)) }),
  },
  {
    method: 'POST',
    pattern: /^\/api\/me\/collection\/(\d+)\/pin$/,
    describe: (body, id) => ({
      action: body.pinned === false ? 'Protection retirée' : 'Carte protégée',
      detail: `carte #${id}`,
    }),
  },
  {
    method: 'POST',
    pattern: /^\/api\/trades\/offers\/([^/]+)\/accept$/,
    describe: (body, id) => {
      const given = positiveInt(body.withId);
      return {
        action: 'Échange accepté',
        detail: join(`offre ${shortId(id)}`, given === null ? '' : `carte #${given} donnée`),
      };
    },
  },
  {
    method: 'PUT',
    pattern: /^\/api\/me\/wishlist\/(\d+)$/,
    describe: (_body, id) => ({ action: 'Envie ajoutée', detail: `carte #${id}` }),
  },
  {
    method: 'DELETE',
    pattern: /^\/api\/me\/wishlist\/(\d+)$/,
    describe: (_body, id) => ({ action: 'Envie retirée', detail: `carte #${id}` }),
  },
  {
    method: 'POST',
    pattern: /^\/api\/market\/buy-orders$/,
    describe: (body) => ({
      action: 'Ordre d’achat',
      detail: join(card(body.characterId), money(body.price), times(body.qty)),
    }),
  },
  {
    method: 'POST',
    pattern: /^\/api\/market\/buy-orders\/([^/]+)\/cancel$/,
    describe: (_body, id) => ({ action: 'Ordre annulé', detail: `ordre ${shortId(id)}` }),
  },
  {
    method: 'POST',
    pattern: /^\/api\/packs\/([^/]+)\/open-many$/,
    describe: (body, id) => ({
      action: 'Booster ouvert',
      detail: join(`booster ${shortId(id)}`, times(body.count), money(body.maxChakra)),
    }),
  },
];

/** Libellé d'une écriture, déduit de sa méthode et de son chemin. */
export function describeWrite(method: string, path: string, body?: unknown): WriteDescription {
  const verb = method.toUpperCase();
  const pathname = path.split('?')[0] ?? path;
  const source = asRecord(body);
  for (const rule of RULES) {
    if (rule.method !== verb) continue;
    const match = pathname.match(rule.pattern);
    if (match) return rule.describe(source, match[1] ?? '');
  }
  return { action: 'Écriture', detail: `${verb} ${pathname}`.slice(0, 120) };
}

/** Une entrée lisible et bornée, `null` si elle est inutilisable. */
function cleanEntry(item: unknown): WriteLogEntry | null {
  const entry = asRecord(item);
  const at = Number(entry.at);
  const action = text(entry.action, 60);
  if (!Number.isFinite(at) || at <= 0 || !action) return null;
  const status = Number(entry.status);
  return {
    at,
    action,
    detail: text(entry.detail, 120),
    method: text(entry.method, 12).toUpperCase() || 'POST',
    path: text(entry.path, 200),
    ok: entry.ok === true,
    status: Number.isFinite(status) && status > 0 ? Math.trunc(status) : null,
    error: text(entry.error, 160) || null,
  };
}

/** Journal trié du plus ancien au plus récent, borné aux dernières écritures. */
export function normalizeWriteLog(raw: unknown): WriteLogEntry[] {
  if (!Array.isArray(raw)) return [];
  const entries: WriteLogEntry[] = [];
  for (const item of raw) {
    const entry = cleanEntry(item);
    if (entry) entries.push(entry);
  }
  return entries.sort((a, b) => a.at - b.at).slice(-WRITE_LOG_MAX);
}

let chain: Promise<void> = Promise.resolve();

/** Ajoute une écriture au journal, en gardant les plus récentes. Ne lève jamais. */
export function recordWrite(
  entry: Omit<WriteLogEntry, 'at'> & { at?: number },
  now = Date.now(),
): Promise<void> {
  const clean = cleanEntry({ ...entry, at: entry.at ?? now });
  if (!clean) return Promise.resolve();
  chain = chain
    .then(async () => {
      const entries = normalizeWriteLog(await writeLogItem.getValue());
      await writeLogItem.setValue([...entries, clean].slice(-WRITE_LOG_MAX));
    })
    .catch(() => undefined);
  return chain;
}

/** Journalise une requête d'écriture à partir de son chemin. Ne lève jamais. */
export function recordWriteRequest(
  method: string,
  path: string,
  body: unknown,
  outcome: Pick<WriteLogEntry, 'ok' | 'status' | 'error'>,
): void {
  const { action, detail } = describeWrite(method, path, body);
  void recordWrite({ ...outcome, action, detail, method, path });
}

/** Journal trié du plus ancien au plus récent. */
export async function getWriteLog(): Promise<WriteLogEntry[]> {
  try {
    return normalizeWriteLog(await writeLogItem.getValue());
  } catch {
    return [];
  }
}

/** Ligne lisible d'une entrée, partagée par le panneau et le pont. */
export function writeLogLine(entry: WriteLogEntry): string {
  const base = entry.detail ? `${entry.action} · ${entry.detail}` : entry.action;
  return entry.ok ? base : `${base} — ${entry.error ?? 'refus'}`;
}

/** Identifiant stable d'un libellé, pour filtrer sans dépendre des accents. */
export function actionSlug(action: string): string {
  return action
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export interface WriteLogSummary {
  total: number;
  /** Écritures depuis minuit, heure locale. */
  today: number;
  failed: number;
  lastAt: number | null;
  /** Écritures par libellé, pour un tableau de bord sans relire chaque entrée. */
  byAction: Record<string, number>;
  /** Instant du dernier refus, `null` si tout a réussi. */
  lastFailureAt: number | null;
}

/** Compteurs du journal : total, écritures du jour, refus, dernière écriture, par action. */
export function writeLogSummary(entries: readonly WriteLogEntry[], now = Date.now()): WriteLogSummary {
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const start = midnight.getTime();
  const byAction: Record<string, number> = {};
  let today = 0;
  let failed = 0;
  let lastFailureAt: number | null = null;
  for (const entry of entries) {
    byAction[entry.action] = (byAction[entry.action] ?? 0) + 1;
    if (entry.at >= start) today += 1;
    if (!entry.ok) {
      failed += 1;
      lastFailureAt = entry.at;
    }
  }
  return {
    total: entries.length,
    today,
    failed,
    lastAt: entries[entries.length - 1]?.at ?? null,
    byAction,
    lastFailureAt,
  };
}
