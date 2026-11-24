import { authHeaders, type Session } from './auth';
import { recordWriteRequest } from './write-log';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code: string | null = null,
    /** Corps de la réponse d'erreur, pour lire une borne de prix ou un motif de refus. */
    readonly data: unknown = undefined,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Session expirée ou absente (401). */
export class AuthError extends ApiError {
  constructor(message = 'Session expirée') {
    super(401, message, 'unauthorized');
    this.name = 'AuthError';
  }
}

/** Le site exige une vérification anti-robot : à faire à la main sur kyara.games. */
export class PassRequiredError extends ApiError {
  constructor(status: number) {
    super(status, 'Vérification anti-robot demandée', 'pass_required');
    this.name = 'PassRequiredError';
  }
}

export class RateLimitedError extends ApiError {
  constructor() {
    super(429, 'Trop de requêtes', 'rate_limited');
    this.name = 'RateLimitedError';
  }
}

export interface ApiClientOptions {
  baseUrl?: string;
  getSession: () => Promise<Session | null>;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Écart minimal entre deux départs de requêtes. */
  minGapMs?: number;
  /** Porte exécutée avant chaque tentative : budget partagé des automatisations. */
  gate?: () => Promise<void>;
  timeoutMs?: number;
  maxRateLimitRetries?: number;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  timeoutMs?: number;
}

const MAX_PAUSE_MS = 10 * 60 * 1000;

export function retryDelayMs(retryAfter: string | null, attempt: number): number {
  const seconds = retryAfter === null ? NaN : Number(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(MAX_PAUSE_MS, seconds * 1000);
  return Math.min(MAX_PAUSE_MS, 4000 * 2 ** attempt);
}

/**
 * Client de l'API Kyara. Les requêtes partent une par une avec un écart minimal
 * (le site coupe l'accès après une rafale). N'envoie jamais `x-pass`.
 */
export function createApiClient(options: ApiClientOptions) {
  const baseUrl = options.baseUrl ?? 'https://kyara.games';
  const fetchImpl = options.fetchImpl ?? ((...args) => fetch(...args));
  const sleep = options.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? Date.now;
  const minGapMs = options.minGapMs ?? 350;
  const defaultTimeout = options.timeoutMs ?? 20_000;
  const maxRetries = options.maxRateLimitRetries ?? 3;

  let queue: Promise<unknown> = Promise.resolve();
  let lastStart = 0;

  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = queue.then(task);
    queue = result.catch(() => undefined);
    return result;
  }

  async function send<T>(path: string, request: RequestOptions): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      const wait = lastStart + minGapMs - now();
      if (wait > 0) await sleep(wait);
      lastStart = now();

      if (options.gate) await options.gate();
      const session = await options.getSession();
      const headers: Record<string, string> = {
        accept: 'application/json',
        ...authHeaders(session),
      };
      if (request.body !== undefined) headers['content-type'] = 'application/json';

      const response = await fetchImpl(baseUrl + path, {
        method: request.method ?? 'GET',
        headers,
        credentials: 'include',
        cache: 'no-store',
        body: request.body === undefined ? undefined : JSON.stringify(request.body),
        signal: AbortSignal.timeout(request.timeoutMs ?? defaultTimeout),
      });

      if (response.status === 429) {
        if (attempt >= maxRetries) throw new RateLimitedError();
        await sleep(retryDelayMs(response.headers.get('retry-after'), attempt));
        continue;
      }

      const text = await response.text();
      let data: unknown = null;
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = text;
        }
      }
      if (response.ok) return data as T;

      const record = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
      const code =
        typeof record.code === 'string'
          ? record.code
          : typeof record.error === 'string'
            ? record.error
            : null;
      const message =
        typeof record.message === 'string' ? record.message : `HTTP ${response.status}`;
      if (response.status === 401) throw new AuthError(message);
      if (code === 'pass_required') throw new PassRequiredError(response.status);
      throw new ApiError(response.status, message, code, data);
    }
  }

  return {
    request<T = unknown>(path: string, request: RequestOptions = {}): Promise<T> {
      if (!path.startsWith('/api/')) {
        return Promise.reject(new ApiError(0, 'Chemin API invalide', 'invalid_path'));
      }
      const method = request.method ?? 'GET';
      const task = enqueue(() => send<T>(path, request));
      // Journal local des écritures de jeu : une entrée par requête, réussie ou refusée.
      if (method === 'GET') return task;
      return task.then(
        (value) => {
          recordWriteRequest(method, path, request.body, { ok: true, status: null, error: null });
          return value;
        },
        (error: unknown) => {
          recordWriteRequest(method, path, request.body, {
            ok: false,
            status: error instanceof ApiError ? error.status : null,
            error: error instanceof Error ? error.message : 'erreur inconnue',
          });
          throw error;
        },
      );
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
